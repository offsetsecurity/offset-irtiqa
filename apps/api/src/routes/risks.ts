import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, withTransaction } from "../db/pool.js";
import { canRead, canWrite, requireAuth, assertCanWrite } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { badRequest, notFound, HttpError } from "../lib/errors.js";

const idParam = z.object({ id: z.string().uuid() });
const score = z.number().int().min(1).max(5);

const TREATMENTS = ["Mitigate", "Accept", "Transfer", "Avoid"] as const;
const STATUSES = ["Open", "Treated", "Accepted", "Closed"] as const;

const riskBody = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(10_000).default(""),
  category: z.string().max(80).default(""),
  likelihood: score,
  impact: score,
  resLikelihood: score.nullish(),
  resImpact: score.nullish(),
  treatment: z.enum(TREATMENTS).default("Mitigate"),
  status: z.enum(STATUSES).default("Open"),
  owner: z.string().max(200).default(""),
  reviewDate: z.string().date().nullish(),
  acceptedBy: z.string().max(200).nullish(),
  acceptedDate: z.string().date().nullish(),
  controlIds: z.array(z.string().uuid()).default([]),
});

const riskPatch = riskBody.partial().strict();

/** Inherent and residual scores, plus the band the heat map colours by. */
const SCORES = `
  (r.likelihood * r.impact) as inherent,
  (coalesce(r.res_likelihood, r.likelihood) * coalesce(r.res_impact, r.impact)) as residual,
  case
    when (r.likelihood * r.impact) >= 20 then 'critical'
    when (r.likelihood * r.impact) >= 12 then 'elevated'
    else 'acceptable'
  end as band`;

const CONTROL_IDS = `
  (select json_group_array(rc.control_id)
     from risk_controls rc where rc.risk_id = r.id) as control_ids_json`;

interface RiskRow {
  id: string;
  control_ids_json: string | null;
  [key: string]: unknown;
}

const hydrate = (row: RiskRow): Record<string, unknown> => {
  const { control_ids_json, ...rest } = row;
  return { ...rest, control_ids: JSON.parse(control_ids_json ?? "[]") };
};

async function replaceLinks(
  tx: { query: typeof query },
  riskId: string,
  controlIds: string[],
): Promise<void> {
  await tx.query("delete from risk_controls where risk_id = $1", [riskId]);
  for (const controlId of controlIds) {
    await tx.query("insert or ignore into risk_controls (risk_id, control_id) values ($1, $2)", [
      riskId,
      controlId,
    ]);
  }
}

/**
 * Refuses a second risk with the same title. Two copies of one risk split its
 * controls and evidence between them, and the register reads as if it were two
 * problems. Case and spacing do not make a different risk.
 */
async function refuseDuplicate(title: string, exceptId?: string): Promise<void> {
  const { rows } = await query<{ seq: number }>(
    `select seq from risks where lower(trim(title)) = lower(trim($1)) ${exceptId ? "and id <> $2" : ""} limit 1`,
    exceptId ? [title, exceptId] : [title],
  );
  if (rows[0]) throw new HttpError(409, `There is already a risk called this: #${rows[0].seq}. Open that one instead.`);
}

export async function riskRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/risks", { preHandler: canRead }, async (request) => {
    const q = z
      .object({
        status: z.enum(STATUSES).optional(),
        band: z.enum(["critical", "elevated", "acceptable"]).optional(),
        owner: z.string().optional(),
      })
      .parse(request.query);

    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) {
      params.push(q.status);
      where.push(`r.status = $${params.length}`);
    }
    if (q.owner) {
      params.push(q.owner);
      where.push(`r.owner = $${params.length}`);
    }

    const { rows } = await query<RiskRow>(
      `select r.*, ${SCORES}, ${CONTROL_IDS}
         from risks r
        ${where.length ? `where ${where.join(" and ")}` : ""}
        order by (r.likelihood * r.impact) desc, r.seq`,
      params,
    );

    const hydrated = rows.map(hydrate);
    return { risks: q.band ? hydrated.filter((r) => r["band"] === q.band) : hydrated };
  });

  /** Registered before /:id so the literal path wins. */
  app.get("/api/v1/risks/summary", { preHandler: canRead }, async () => {
    const { rows } = await query<{
      band: string; status: string; likelihood: number; impact: number; n: number;
    }>(
      `select case
                when (r.likelihood * r.impact) >= 20 then 'critical'
                when (r.likelihood * r.impact) >= 12 then 'elevated'
                else 'acceptable'
              end as band,
              r.status, r.likelihood, r.impact, count(*) as n
         from risks r
        group by band, r.status, r.likelihood, r.impact`,
    );

    const byBand: Record<string, number> = { critical: 0, elevated: 0, acceptable: 0 };
    const byStatus: Record<string, number> = {};
    const heatmap: Record<string, number> = {};

    for (const r of rows) {
      byBand[r.band] = (byBand[r.band] ?? 0) + r.n;
      byStatus[r.status] = (byStatus[r.status] ?? 0) + r.n;
      const cell = `${r.impact}x${r.likelihood}`;
      heatmap[cell] = (heatmap[cell] ?? 0) + r.n;
    }

    return {
      byBand,
      byStatus,
      heatmap,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    };
  });

  app.get("/api/v1/risks/:id", { preHandler: canRead }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { rows } = await query<RiskRow>(
      `select r.*, ${SCORES}, ${CONTROL_IDS} from risks r where r.id = $1`,
      [id],
    );
    if (!rows[0]) throw notFound("Risk not found.");
    return { risk: hydrate(rows[0]) };
  });

  app.post("/api/v1/risks", { preHandler: canWrite }, async (request, reply) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const body = riskBody.parse(request.body);

    if (body.status === "Accepted" && !body.acceptedBy) {
      throw badRequest("An accepted risk needs a named person who accepted it.");
    }
    await refuseDuplicate(body.title);

    const id = randomUUID();

    const created = await withTransaction(async (tx) => {
      // SQLite has no identity column, so the display sequence is allocated
      // inside the write transaction where it cannot race.
      const { rows: seqRows } = await tx.query<{ next: number }>(
        "select coalesce(max(seq), 0) + 1 as next from risks",
      );
      const seq = seqRows[0]?.next ?? 1;

      const { rows } = await tx.query(
        `insert into risks (id, seq, title, description, category, likelihood, impact,
                            res_likelihood, res_impact, treatment, status, owner,
                            review_date, accepted_by, accepted_date)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
        [
          id, seq, body.title, body.description, body.category, body.likelihood, body.impact,
          body.resLikelihood ?? null, body.resImpact ?? null, body.treatment, body.status,
          body.owner, body.reviewDate ?? null, body.acceptedBy ?? null, body.acceptedDate ?? null,
        ],
      );
      await replaceLinks(tx, id, body.controlIds);
      return rows[0]!;
    });

    await audit(request, { action: "Risk added", entity: "risk", entityId: id, after: created });
    reply.code(201);
    return { risk: created };
  });

  app.patch("/api/v1/risks/:id", { preHandler: canWrite }, async (request) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const { id } = idParam.parse(request.params);
    const body = riskPatch.parse(request.body);

    const { rows: existing } = await query<Record<string, unknown>>(
      "select * from risks where id = $1",
      [id],
    );
    const before = existing[0];
    if (!before) throw notFound("Risk not found.");
    if (body.title !== undefined) await refuseDuplicate(body.title, id);

    if ((body.status ?? before["status"]) === "Accepted" && !(body.acceptedBy ?? before["accepted_by"])) {
      throw badRequest("An accepted risk needs a named person who accepted it.");
    }

    const COLUMN: Record<string, string> = {
      title: "title", description: "description", category: "category",
      likelihood: "likelihood", impact: "impact", resLikelihood: "res_likelihood",
      resImpact: "res_impact", treatment: "treatment", status: "status", owner: "owner",
      reviewDate: "review_date", acceptedBy: "accepted_by", acceptedDate: "accepted_date",
    };

    const updated = await withTransaction(async (tx) => {
      const entries = Object.entries(body).filter(([k]) => k in COLUMN);
      let row = before;
      if (entries.length) {
        const sets = entries.map(([k], i) => `${COLUMN[k]} = $${i + 2}`);
        const { rows } = await tx.query<Record<string, unknown>>(
          `update risks set ${sets.join(", ")} where id = $1 returning *`,
          [id, ...entries.map(([, v]) => v ?? null)],
        );
        row = rows[0]!;
      }
      if (body.controlIds !== undefined) await replaceLinks(tx, id, body.controlIds);
      return row;
    });

    await audit(request, {
      action: "Risk updated",
      entity: "risk",
      entityId: id,
      before,
      after: updated,
    });
    return { risk: updated };
  });

  app.delete("/api/v1/risks/:id", { preHandler: canWrite }, async (request, reply) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const { id } = idParam.parse(request.params);
    const { rows } = await query("delete from risks where id = $1 returning *", [id]);
    if (!rows[0]) throw notFound("Risk not found.");
    await audit(request, { action: "Risk deleted", entity: "risk", entityId: id, before: rows[0] });
    reply.code(204);
  });
}
