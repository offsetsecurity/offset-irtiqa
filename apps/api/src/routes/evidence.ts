import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import {
  deleteStored, pathOfStored, storeFile, UploadTooLarge,
} from "../lib/files.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, withTransaction } from "../db/pool.js";
import { canRead, canWrite, requireAuth, assertCanWrite } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { config } from "../config.js";

const idParam = z.object({ id: z.string().uuid() });

const evidenceBody = z.object({
  name: z.string().min(1).max(300),
  type: z.string().max(60).default("Document"),
  owner: z.string().max(200).default(""),
  // Chased only when there is also a review date. Empty is normal.
  ownerEmail: z.union([z.literal(""), z.string().email("That is not an email address.")]).default(""),
  collectedDate: z.string().date().nullish(),
  nextReview: z.string().date().nullish(),
  notes: z.string().max(10_000).default(""),
  controlIds: z.array(z.string().uuid()).default([]),
});

const evidencePatch = evidenceBody.partial().strict();

/**
 * The 30-60-90 freshness radar the product is built around: evidence ages, and
 * an assessor wants recent proof. Computed in SQL so the list and the summary
 * can never disagree.
 */
const FRESHNESS = `
  case
    when e.collected_date is null then 'unknown'
    when e.collected_date > date('now','-30 days') then 'fresh'
    when e.collected_date > date('now','-60 days') then 'ageing'
    when e.collected_date > date('now','-90 days') then 'due'
    else 'stale'
  end as freshness,
  cast(julianday('now') - julianday(e.collected_date) as integer) as age_days`;

/** Linked control ids, as a JSON array SQLite can build in one pass. */
const CONTROL_IDS = `
  (select json_group_array(ec.control_id)
     from evidence_controls ec where ec.evidence_id = e.id) as control_ids_json`;

interface EvidenceRow {
  id: string;
  control_ids_json: string | null;
  [key: string]: unknown;
}

const hydrate = (row: EvidenceRow): Record<string, unknown> => {
  const { control_ids_json, ...rest } = row;
  return { ...rest, control_ids: JSON.parse(control_ids_json ?? "[]") };
};

async function replaceLinks(
  tx: { query: typeof query },
  evidenceId: string,
  controlIds: string[],
): Promise<void> {
  await tx.query("delete from evidence_controls where evidence_id = $1", [evidenceId]);
  for (const controlId of controlIds) {
    await tx.query(
      "insert or ignore into evidence_controls (evidence_id, control_id) values ($1, $2)",
      [evidenceId, controlId],
    );
  }
}

export async function evidenceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/evidence", { preHandler: canRead }, async (request) => {
    const q = z
      .object({
        freshness: z.enum(["fresh", "ageing", "due", "stale", "unknown"]).optional(),
        owner: z.string().optional(),
      })
      .parse(request.query);

    const { rows } = await query<EvidenceRow>(
      `select e.*, ${FRESHNESS}, ${CONTROL_IDS}
         from evidence e
        ${q.owner ? "where e.owner = $1" : ""}
        order by e.collected_date desc, e.name`,
      q.owner ? [q.owner] : [],
    );

    const hydrated = rows.map(hydrate);
    return {
      evidence: q.freshness ? hydrated.filter((r) => r["freshness"] === q.freshness) : hydrated,
    };
  });

  /** Registered before /:id so the literal path wins. */
  app.get("/api/v1/evidence/summary", { preHandler: canRead }, async () => {
    const { rows: fresh } = await query<{ freshness: string; n: number }>(
      `select case
                when e.collected_date is null then 'unknown'
                when e.collected_date > date('now','-30 days') then 'fresh'
                when e.collected_date > date('now','-60 days') then 'ageing'
                when e.collected_date > date('now','-90 days') then 'due'
                else 'stale'
              end as freshness,
              count(*) as n
         from evidence e group by freshness`,
    );

    // The gap that matters most to an assessor: a control claimed as
    // implemented with nothing attached to prove it.
    const { rows: gaps } = await query<{ n: number }>(
      `select count(*) as n
         from controls c
        where c.status = 'implemented'
          and not exists (select 1 from evidence_controls ec where ec.control_id = c.id)`,
    );

    const byFreshness: Record<string, number> = {};
    for (const r of fresh) byFreshness[r.freshness] = r.n;

    return {
      byFreshness,
      total: Object.values(byFreshness).reduce((a, b) => a + b, 0),
      controlsImplementedWithoutEvidence: gaps[0]?.n ?? 0,
    };
  });

  app.get("/api/v1/evidence/:id", { preHandler: canRead }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { rows } = await query<EvidenceRow>(
      `select e.*, ${FRESHNESS}, ${CONTROL_IDS} from evidence e where e.id = $1`,
      [id],
    );
    if (!rows[0]) throw notFound("Evidence not found.");
    return { evidence: hydrate(rows[0]) };
  });

  app.post("/api/v1/evidence", { preHandler: canWrite }, async (request, reply) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const body = evidenceBody.parse(request.body);
    const id = randomUUID();

    const created = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `insert into evidence (id, name, type, owner, owner_email, collected_date, next_review, notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [id, body.name, body.type, body.owner, body.ownerEmail,
         body.collectedDate ?? null, body.nextReview ?? null, body.notes],
      );
      await replaceLinks(tx, id, body.controlIds);
      return rows[0]!;
    });

    await audit(request, {
      action: "Evidence added",
      entity: "evidence",
      entityId: id,
      after: created,
    });
    reply.code(201);
    return { evidence: created };
  });

  app.patch("/api/v1/evidence/:id", { preHandler: canWrite }, async (request) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const { id } = idParam.parse(request.params);
    const body = evidencePatch.parse(request.body);

    const { rows: existing } = await query("select * from evidence where id = $1", [id]);
    const before = existing[0];
    if (!before) throw notFound("Evidence not found.");

    const COLUMN: Record<string, string> = {
      name: "name", type: "type", owner: "owner", ownerEmail: "owner_email",
      collectedDate: "collected_date", nextReview: "next_review", notes: "notes",
    };

    const updated = await withTransaction(async (tx) => {
      const entries = Object.entries(body).filter(([k]) => k in COLUMN);
      let row = before;
      if (entries.length) {
        const sets = entries.map(([k], i) => `${COLUMN[k]} = $${i + 2}`);
        const { rows } = await tx.query(
          `update evidence set ${sets.join(", ")} where id = $1 returning *`,
          [id, ...entries.map(([, v]) => v ?? null)],
        );
        row = rows[0]!;
      }
      // Links are replaced wholesale when supplied — simplest contract for the UI.
      if (body.controlIds !== undefined) await replaceLinks(tx, id, body.controlIds);
      return row;
    });

    await audit(request, {
      action: "Evidence updated",
      entity: "evidence",
      entityId: id,
      before,
      after: updated,
    });
    return { evidence: updated };
  });

  app.delete("/api/v1/evidence/:id", { preHandler: canWrite }, async (request, reply) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const { id } = idParam.parse(request.params);

    const { rows } = await query<{ file_key: string | null }>(
      "delete from evidence where id = $1 returning *",
      [id],
    );
    if (!rows[0]) throw notFound("Evidence not found.");

    // The row is gone, so nothing can reach the file again. Leaving it would
    // accumulate orphans nobody can account for, which in a compliance tool is
    // its own small problem.
    await deleteStored(rows[0].file_key);

    await audit(request, {
      action: "Evidence deleted",
      entity: "evidence",
      entityId: id,
      before: rows[0],
    });
    reply.code(204);
  });

  // ── the file itself ——————————————————————————

  /**
   * Attaches a file, replacing any existing one.
   *
   * The name the browser sends is recorded as a label and never touches a path;
   * everything is stored under a key this server generated. See lib/files.ts.
   */
  app.post("/api/v1/evidence/:id/file", { preHandler: canWrite }, async (request, reply) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const { id } = idParam.parse(request.params);

    const existing = await query<{ file_key: string | null }>(
      "select file_key from evidence where id = $1",
      [id],
    );
    if (!existing.rows[0]) throw notFound("Evidence not found.");

    const part = await request.file();
    if (!part) throw badRequest("No file was attached.");

    let stored;
    try {
      stored = await storeFile(part.file, part.filename);
    } catch (err) {
      if (err instanceof UploadTooLarge) throw badRequest(err.message);
      throw err;
    }

    // @fastify/multipart sets this when its own limit cut the stream short. The
    // bytes on disk would be a truncated file that looks perfectly valid.
    if (part.file.truncated) {
      await deleteStored(stored.key);
      throw badRequest(`That file is larger than the ${config.MAX_UPLOAD_MB} MB limit.`);
    }

    const { rows } = await query(
      `update evidence
          set file_key = $1, file_name = $2, file_size = $3, file_sha256 = $4,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        where id = $5
      returning *`,
      [stored.key, stored.name, stored.size, stored.sha256, id],
    );

    // Replacing one leaves the old file unreachable, so remove it afterwards:
    // after the row is updated, so a failure cannot lose the only copy.
    await deleteStored(existing.rows[0].file_key);

    await audit(request, {
      action: "Evidence file attached",
      entity: "evidence",
      entityId: id,
      after: { file: stored.name, bytes: stored.size, sha256: stored.sha256 },
    });

    reply.code(201);
    return { evidence: rows[0] };
  });

  /**
   * Sends the file back.
   *
   * Always as an attachment, always as octet-stream. An uploaded .html or .svg
   * served inline would run on this origin with the viewer's session, which
   * turns an evidence store into stored cross-site scripting. Nobody needs to
   * preview evidence in the browser badly enough to be worth that.
   */
  app.get("/api/v1/evidence/:id/file", { preHandler: canRead }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { rows } = await query<{ file_key: string | null; file_name: string | null }>(
      "select file_key, file_name from evidence where id = $1",
      [id],
    );
    if (!rows[0]) throw notFound("Evidence not found.");

    const path = await pathOfStored(rows[0].file_key);
    if (!path) throw notFound("No file is attached to this evidence.");

    const name = rows[0].file_name ?? "attachment";
    reply
      .header("content-type", "application/octet-stream")
      // The quoted form for old clients, then RFC 5987 for anything since 2010,
      // which is what actually carries a name with non-ASCII in it.
      .header(
        "content-disposition",
        `attachment; filename="${name.replace(/["\\]/g, "")}"; ` +
          `filename*=UTF-8''${encodeURIComponent(name)}`,
      )
      .header("x-content-type-options", "nosniff");

    return reply.send(createReadStream(path));
  });

  /** Removes the attachment, keeping the evidence record. */
  app.delete("/api/v1/evidence/:id/file", { preHandler: canWrite }, async (request, reply) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const { id } = idParam.parse(request.params);

    const { rows } = await query<{ file_key: string | null; file_name: string | null }>(
      "select file_key, file_name from evidence where id = $1",
      [id],
    );
    if (!rows[0]) throw notFound("Evidence not found.");
    if (!rows[0].file_key) throw notFound("No file is attached to this evidence.");

    await query(
      `update evidence
          set file_key = null, file_name = null, file_size = null, file_sha256 = null,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        where id = $1`,
      [id],
    );
    await deleteStored(rows[0].file_key);

    await audit(request, {
      action: "Evidence file removed",
      entity: "evidence",
      entityId: id,
      before: { file: rows[0].file_name },
    });
    reply.code(204);
  });
}
