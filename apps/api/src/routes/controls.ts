import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, withTransaction } from "../db/pool.js";
import { canRead, canWrite, requireAuth, assertCanWrite } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { notFound } from "../lib/errors.js";
import { MATURITY_DEFAULT_TARGET, MATURITY_MAX, MATURITY_MIN } from "../config.js";
import { compareRefs } from "../lib/refs.js";

const STATUSES = ["not_started", "in_progress", "implemented", "not_applicable"] as const;

/**
 * Nullable on purpose. Nought is a real score — SAMA's level 0 means the
 * control does not exist — so it cannot also stand for "nobody has looked at
 * this yet". Null carries that, and the two read very differently on a
 * dashboard.
 */
const maturityValue = z.number().int().min(MATURITY_MIN).max(MATURITY_MAX).nullable();

/**
 * A plain ISO date, or nothing.
 *
 * Stored as text because SQLite has no date type and every other date in this
 * schema is text in this format. Validated here rather than trusted, since the
 * reminder job compares it with `date('now')` and a malformed value would sort
 * into the wrong place rather than fail loudly.
 */
const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "A due date must look like 2026-03-31.")
  .nullable();

/**
 * Where to write when this control needs attention.
 *
 * Separate from `owner`, which is a person's name and often a team's. An empty
 * string means nobody is chased, which is the default and is not an error: a
 * fresh install should not start emailing anyone.
 */
const ownerEmail = z.union([z.literal(""), z.string().email("That is not an email address.")]);

const patchBody = z
  .object({
    status: z.enum(STATUSES).optional(),
    maturity: maturityValue.optional(),
    targetMaturity: maturityValue.optional(),
    dueDate: dueDate.optional(),
    ownerEmail: ownerEmail.optional(),
    owner: z.string().max(200).optional(),
    notes: z.string().max(10_000).optional(),
    mapped: z.string().max(500).optional(),
    justification: z.string().max(10_000).optional(),
    // Product-specific fields (CSF profile statements and Tiers, 800-53
    // parameter values and origination) are merged into the JSON attrs column
    // rather than fanning the schema out three ways.
    attrs: z.record(z.unknown()).optional(),
  })
  .strict();

interface TestRow {
  id: string;
  control_id: string;
  tested_on: string;
  tester: string;
  result: string;
  note: string;
  created_at: string;
}

/** A test is a fact about a day, so the date is required and the result is one of three. */
const testBody = z
  .object({
    testedOn: z.string().date(),
    tester: z.string().max(200).default(""),
    result: z.enum(["Pass", "Fail", "Partial"]),
    note: z.string().max(4000).default(""),
  })
  .strict();

const listQuery = z.object({
  theme: z.string().optional(),
  status: z.enum(STATUSES).optional(),
  owner: z.string().optional(),
  q: z.string().optional(),
});

interface ControlRow {
  id: string;
  ref: string;
  title: string;
  theme: string;
  parent_ref: string | null;
  status: string;
  maturity: number | null;
  target_maturity: number | null;
  due_date: string | null;
  owner_email: string | null;
  owner: string;
  notes: string;
  mapped: string;
  justification: string;
  attrs: string;
  updated_at: string;
  /** How many evidence items are linked. Only the list carries it. */
  evidence_count?: number;
}

/** attrs is stored as JSON text; the API always speaks objects. */
const hydrate = <T extends { attrs?: string }>(row: T): Omit<T, "attrs"> & { attrs: unknown } => ({
  ...row,
  attrs: JSON.parse(row.attrs ?? "{}"),
});

export async function controlRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/controls", { preHandler: canRead }, async (request) => {
    const q = listQuery.parse(request.query);

    const where: string[] = [];
    const params: unknown[] = [];

    if (q.theme) {
      params.push(q.theme);
      where.push(`theme = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`status = $${params.length}`);
    }
    if (q.owner) {
      params.push(q.owner);
      where.push(`owner = $${params.length}`);
    }
    if (q.q) {
      params.push(`%${q.q.toLowerCase()}%`);
      where.push(`(lower(ref) like $${params.length} or lower(title) like $${params.length})`);
    }

    const { rows } = await query<ControlRow>(
      `select id, ref, title, theme, parent_ref, status, maturity, target_maturity,
              due_date, owner_email, owner, notes, mapped,
              justification, attrs, updated_at,
              (select count(*) from evidence_controls ec where ec.control_id = controls.id) as evidence_count
         from controls
        ${where.length ? `where ${where.join(" and ")}` : ""}`,
      params,
    );
    // Sorted here rather than in SQL, because "3.3.10" has to come after
    // "3.3.2" and text ordering puts it before. See lib/refs.ts.
    return { controls: rows.sort((a, b) => compareRefs(a.ref, b.ref)).map(hydrate) };
  });

  /** Registered before /:id so the literal path wins. */
  app.get("/api/v1/controls/summary", { preHandler: canRead }, async () => {
    const { rows } = await query<{ status: string; theme: string; n: number }>(
      "select status, theme, count(*) as n from controls group by status, theme",
    );

    const byStatus: Record<string, number> = {};
    const byTheme: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + r.n;
      (byTheme[r.theme] ??= {})[r.status] = r.n;
    }

    const applicable = Object.entries(byStatus)
      .filter(([s]) => s !== "not_applicable")
      .reduce((a, [, n]) => a + n, 0);
    const implemented = byStatus["implemented"] ?? 0;

    /**
     * Maturity, for the frameworks that score rather than tick.
     *
     * Both numbers, because they answer different questions and a single one
     * misleads. "82% at or above target" is the compliance answer SAMA wants.
     * "average 3.4" is how far along the whole programme is. A programme can
     * sit at 100% of a target of 3 and still average 3.0, which is a fine place
     * to be and a poor place to stop.
     *
     * Controls nobody has scored are excluded rather than counted as nought.
     * Treating "not looked at" as "does not exist" flatters nobody and makes
     * the first week of use look like a catastrophe.
     */
    const mat = await query<{ in_scope: number; scored: number; at_target: number; total_score: number }>(
      `select
         count(*) as in_scope,
         count(maturity) as scored,
         sum(case when maturity is not null
                   and maturity >= coalesce(target_maturity, $1)
                  then 1 else 0 end) as at_target,
         coalesce(sum(maturity), 0) as total_score
       from controls
      where status <> 'not_applicable'`,
      [MATURITY_DEFAULT_TARGET],
    );
    /**
     * "In scope" is every control the customer has not ruled out.
     *
     * An excluded item is not an unscored one waiting to be looked at, so it
     * is out of the totals entirely rather than sitting in "not assessed"
     * forever making the plan look unfinished. The count of what was excluded
     * is reported separately, because an assessor will want to see it and
     * because hiding it is how a readiness figure becomes dishonest.
     */
    const inScope = mat.rows[0]?.in_scope ?? 0;
    const scored = mat.rows[0]?.scored ?? 0;
    const atTarget = mat.rows[0]?.at_target ?? 0;
    const totalScore = mat.rows[0]?.total_score ?? 0;

    // The spread across the six levels, for the chart that used to slice by a
    // status a maturity framework never sets.
    const levels = await query<{ maturity: number; n: number }>(
      `select maturity, count(*) as n from controls
         where maturity is not null and status <> 'not_applicable'
         group by maturity`,
    );
    const byLevel: Record<string, number> = {};
    for (const r of levels.rows) byLevel[String(r.maturity)] = r.n;

    const byThemeMaturity = (
      await query<{
        theme: string; in_scope: number; scored: number; total_score: number; at_target: number;
      }>(
        `select theme,
                count(*) as in_scope,
                count(maturity) as scored,
                coalesce(sum(maturity), 0) as total_score,
                sum(case when maturity is not null
                          and maturity >= coalesce(target_maturity, $1)
                         then 1 else 0 end) as at_target
           from controls
          where status <> 'not_applicable'
          group by theme`,
        [MATURITY_DEFAULT_TARGET],
      )
    ).rows;

    return {
      byStatus,
      byTheme,
      applicable,
      implemented,
      readinessPct: applicable ? Math.round((implemented / applicable) * 100) : 0,

      maturity: {
        total: inScope,
        excluded: Object.values(byStatus).reduce((a, n) => a + n, 0) - inScope,
        scored,
        unscored: inScope - scored,
        atTarget,
        atTargetPct: scored ? Math.round((atTarget / scored) * 100) : 0,
        average: scored ? Math.round((totalScore / scored) * 10) / 10 : 0,
        byLevel,
        defaultTarget: MATURITY_DEFAULT_TARGET,
        byTheme: Object.fromEntries(
          byThemeMaturity.map((r) => [
            r.theme,
            {
              inScope: r.in_scope,
              scored: r.scored,
              atTarget: r.at_target,
              average: r.scored ? Math.round((r.total_score / r.scored) * 10) / 10 : 0,
            },
          ]),
        ),
      },
    };
  });

  app.get("/api/v1/controls/:id", { preHandler: canRead }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { rows } = await query<ControlRow>("select * from controls where id = $1", [id]);
    if (!rows[0]) throw notFound("Control not found.");
    return { control: hydrate(rows[0]) };
  });

  app.patch("/api/v1/controls/:id", { preHandler: canWrite }, async (request) => {
    requireAuth(request);
    assertCanWrite(request.user.role);

    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = patchBody.parse(request.body);

    const { rows: existing } = await query<ControlRow>("select * from controls where id = $1", [id]);
    const before = existing[0];
    if (!before) throw notFound("Control not found.");

    const sets: string[] = [];
    const params: unknown[] = [id];
    const COLUMN: Record<string, string> = {
      status: "status",
      owner: "owner",
      notes: "notes",
      mapped: "mapped",
      justification: "justification",
      maturity: "maturity",
      targetMaturity: "target_maturity",
      dueDate: "due_date",
      ownerEmail: "owner_email",
    };
    for (const key of Object.keys(COLUMN) as (keyof typeof body)[]) {
      if (body[key] !== undefined) {
        params.push(body[key]);
        sets.push(`${COLUMN[key as string]} = $${params.length}`);
      }
    }
    if (body.attrs !== undefined) {
      // json_patch merges the supplied keys into the stored object, so a caller
      // can update one field without resending the whole thing.
      params.push(JSON.stringify(body.attrs));
      sets.push(`attrs = json_patch(attrs, $${params.length})`);
    }
    if (!sets.length) return { control: hydrate(before) };

    const { rows } = await query<ControlRow>(
      `update controls set ${sets.join(", ")} where id = $1 returning *`,
      params,
    );
    const after = rows[0]!;

    await audit(request, {
      action: "Control updated",
      entity: "control",
      entityId: before.ref,
      before: hydrate(before),
      after: hydrate(after),
    });

    return { control: hydrate(after) };
  });

  // ── control testing ────────────────────────────────────────────────────────
  /**
   * "We tested this on the 3rd, it passed, here is who did it."
   *
   * A status says what somebody believes; a test says what happened on a day.
   * An assessor looking for a control that operates over time is asking for
   * this list, which is why the tests are kept as their own rows rather than
   * as the latest result on the control.
   */
  app.get("/api/v1/controls/:id/tests", { preHandler: canRead }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { rows } = await query<TestRow>(
      `select id, control_id, tested_on, tester, result, note, created_at
         from control_tests where control_id = $1
        order by tested_on desc, created_at desc`,
      [id],
    );
    return { tests: rows };
  });

  // The same links the risk register edits, set from the control's side: which
  // risks this control treats. Replaces the whole set, like a risk's own picker.
  app.put("/api/v1/controls/:id/risks", { preHandler: canWrite }, async (request) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { riskIds } = z.object({ riskIds: z.array(z.string().uuid()).max(500) }).parse(request.body);
    const wanted = [...new Set(riskIds)];

    const { rows: control } = await query<{ ref: string }>("select ref from controls where id = $1", [id]);
    if (!control[0]) throw notFound("Control not found.");
    if (wanted.length) {
      const { rows: found } = await query<{ id: string }>(
        `select id from risks where id in (${wanted.map((_, i) => `$${i + 1}`).join(", ")})`, wanted);
      if (found.length !== wanted.length) throw notFound("One of those risks no longer exists.");
    }

    const { rows: before } = await query<{ risk_id: string }>("select risk_id from risk_controls where control_id = $1", [id]);
    await withTransaction(async (tx) => {
      await tx.query("delete from risk_controls where control_id = $1", [id]);
      for (const riskId of wanted) {
        await tx.query("insert or ignore into risk_controls (risk_id, control_id) values ($1, $2)", [riskId, id]);
      }
    });

    const { rows: risks } = await query<{ id: string; seq: number; title: string }>(
      `select r.id, r.seq, r.title from risk_controls rc join risks r on r.id = rc.risk_id
        where rc.control_id = $1 order by r.seq`, [id]);
    await audit(request, {
      action: "Risks linked to control",
      entity: "control",
      entityId: control[0].ref,
      before: { risks: before.length },
      after: { risks: risks.map((r) => `#${r.seq}`) },
    });
    return { risks };
  });

  app.post("/api/v1/controls/:id/tests", { preHandler: canWrite }, async (request, reply) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = testBody.parse(request.body);

    const { rows: control } = await query<{ ref: string }>("select ref from controls where id = $1", [id]);
    if (!control[0]) throw notFound("Control not found.");

    const { rows } = await query<TestRow>(
      `insert into control_tests (id, control_id, tested_on, tester, result, note)
       values ($1, $2, $3, $4, $5, $6)
       returning id, control_id, tested_on, tester, result, note, created_at`,
      [crypto.randomUUID(), id, body.testedOn, body.tester, body.result, body.note],
    );
    const test = rows[0]!;

    await audit(request, {
      action: "Control tested",
      entity: "control",
      entityId: control[0].ref,
      after: { testedOn: test.tested_on, result: test.result, tester: test.tester },
    });

    reply.code(201);
    return { test };
  });

  app.delete("/api/v1/controls/:id/tests/:testId", { preHandler: canWrite }, async (request, reply) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const { id, testId } = z
      .object({ id: z.string().uuid(), testId: z.string().uuid() })
      .parse(request.params);

    const { rows } = await query<TestRow & { ref: string }>(
      `delete from control_tests where id = $1 and control_id = $2
       returning id, control_id, tested_on, tester, result, note, created_at,
                 (select ref from controls where id = $2) as ref`,
      [testId, id],
    );
    const gone = rows[0];
    if (!gone) throw notFound("Test not found.");

    await audit(request, {
      action: "Control test removed",
      entity: "control",
      entityId: gone.ref,
      before: { testedOn: gone.tested_on, result: gone.result, tester: gone.tester },
    });
    reply.code(204);
  });
}
