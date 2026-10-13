import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { z } from "zod";
import { canRead } from "../auth/rbac.js";
import { compareRefs } from "../lib/refs.js";
import { notFound } from "../lib/errors.js";

/**
 * The golden thread: every risk, the controls that treat it, and the proof
 * that those controls work.
 *
 * It is the line an auditor follows. They pick a risk, ask what reduces it,
 * then ask to see that working. A break anywhere along it - a risk with
 * nothing treating it, a control claimed with no proof, proof too old to show
 * anything - is where findings come from.
 *
 * One read, returned whole, because the screen draws all of it at once and
 * joins it up itself. Judging what counts as broken happens in the screen as
 * well, so the rule a customer reads in the legend and the rule that colours
 * the line are the same code.
 */

/** Older than this, proof no longer shows the control working now. */
export const STALE_DAYS = 90;

interface ControlRow { id: string; ref: string; title: string; theme: string; status: string; owner: string; justification: string }
interface RiskRow { id: string; seq: number; title: string; treatment: string; status: string; owner: string }
interface EvidenceRow { id: string; name: string; collected_date: string | null; age_days: number | null }
interface Link { a: string; control_id: string }

export async function threadRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/thread", { preHandler: canRead }, async () => {
    const [controls, risks, evidence, riskLinks, evidenceLinks] = await Promise.all([
      query<ControlRow>("select id, ref, title, theme, status, owner, justification from controls"),
      query<RiskRow>("select id, seq, title, treatment, status, owner from risks order by seq"),
      query<EvidenceRow>(
        `select id, name, collected_date,
                cast(julianday(date('now')) - julianday(collected_date) as integer) as age_days
           from evidence
          where id in (select evidence_id from evidence_controls)`,
      ),
      query<Link>("select risk_id as a, control_id from risk_controls"),
      query<Link>("select evidence_id as a, control_id from evidence_controls"),
    ]);

    const group = (links: Link[]): Map<string, string[]> => {
      const out = new Map<string, string[]>();
      for (const l of links) out.set(l.a, [...(out.get(l.a) ?? []), l.control_id]);
      return out;
    };
    const byRisk = group(riskLinks.rows);
    const byEvidence = group(evidenceLinks.rows);

    return {
      staleDays: STALE_DAYS,
      // `justified`: the Statement of Applicability gives a reason for this control.
      // The reason itself stays out of this response; the screen only needs to know it is there.
      controls: controls.rows
        .sort((a, b) => compareRefs(a.ref, b.ref))
        .map(({ justification, ...c }) => ({ ...c, justified: justification.trim() !== "" })),
      risks: risks.rows.map((r) => ({ ...r, controls: byRisk.get(r.id) ?? [] })),
      evidence: evidence.rows.map((e) => ({
        id: e.id,
        name: e.name,
        collectedDate: e.collected_date,
        ageDays: e.age_days,
        controls: byEvidence.get(e.id) ?? [],
      })),
    };
  });

  /**
   * One control's part of the thread: the risks it treats, the evidence behind it
   * and how old that is, and its tests. The control's own window turns this into a
   * list of what is missing and how to fix it, so that someone looking at a control
   * sees the same breaks the Golden thread would show, without leaving it.
   */
  app.get("/api/v1/thread/control/:id", { preHandler: canRead }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const found = await query("select 1 from controls where id = $1", [id]);
    if (!found.rows.length) throw notFound("There is no such control.");
    const [risks, evidence, tests] = await Promise.all([
      query<{ id: string; seq: number; title: string }>(
        `select r.id, r.seq, r.title from risk_controls rc join risks r on r.id = rc.risk_id
          where rc.control_id = $1 order by r.seq`,
        [id],
      ),
      query<{ name: string; age_days: number | null }>(
        `select e.name, cast(julianday(date('now')) - julianday(e.collected_date) as integer) as age_days
           from evidence_controls ec join evidence e on e.id = ec.evidence_id
          where ec.control_id = $1 order by e.collected_date desc`,
        [id],
      ),
      query<{ count: number; last: string | null }>(
        "select count(*) as count, max(tested_on) as last from control_tests where control_id = $1",
        [id],
      ),
    ]);
    return {
      staleDays: STALE_DAYS,
      risks: risks.rows,
      evidence: evidence.rows.map((e) => ({ name: e.name, ageDays: e.age_days })),
      tests: { count: Number(tests.rows[0]?.count ?? 0), last: tests.rows[0]?.last ?? null },
    };
  });
}
