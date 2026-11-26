import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, withTransaction } from "../db/pool.js";
import { canRead, canWrite, requireAuth, assertCanWrite } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { hasFeature, packMeta, readPack, themeOrder } from "../lib/pack.js";
import { MATURITY_DEFAULT_TARGET } from "../config.js";
import { dayIso, todayIso } from "../lib/time.js";

/**
 * "If the auditor came today": what a certification auditor (Assure) or a
 * SAMA assessor (Irtiqa) would most likely raise, worked out from the records
 * as they stand. Ported from Offset Attest, where it was built for SOC.
 *
 * It is a forecast, not an audit. Each rule is one an assessment really
 * applies - a control that failed its own test, a control claimed in place
 * with nothing to prove it, evidence over a year old, a finding left past its
 * date, a critical supplier nobody reviewed, a policy not approved, no
 * internal audit or management review in the last year - so the list reads
 * the way an auditor's would, and each item says what to do about it.
 *
 * The words that differ by product, and the references each rule cites, come
 * from the pack's `readiness` block, so the code is the same in every product
 * that turns the feature on.
 */

export type FindingLabel = "Fail" | "Gap" | "Stale" | "Partial";

export interface LikelyFinding {
  id: string;
  ref: string;
  title: string;
  label: FindingLabel;
  /** What the auditor would say. */
  says: string;
  /** What to do about it. */
  fix: string;
  action: { label: string; route: string };
  /** How many findings fixing this one removes. Drives "Fix these first". */
  weight: number;
  /** For a failed test: the control, so a passing retest can be recorded in place. */
  controlId?: string;
}

export interface QuickWin {
  id: string;
  title: string;
  count: number;
  minutes: number;
  route: string;
}

/** The pack's `readiness` block: the words and references for this framework. */
export interface ReadinessWords {
  /** "certification auditor", "SAMA assessor". */
  auditor: string;
  /** "auditor", "assessor". */
  auditorShort: string;
  /** What one is called: "nonconformity", "finding". */
  finding: string;
  findings: string;
  /** The date everything aims at: "certification audit", "SAMA assessment". */
  keyDate: string;
  /** Who carries it out, for the booking form: "Certification body", "Led by". */
  ledBy: string;
  /** References each rule cites. A rule without one is not run. */
  refs: Partial<Record<"policy" | "finding" | "vendor" | "audit" | "review" | "risk", string>>;
}

const DEFAULT_WORDS: ReadinessWords = {
  auditor: "auditor", auditorShort: "auditor", finding: "finding", findings: "findings",
  keyDate: "external audit", ledBy: "Led by", refs: {},
};

export async function readinessWords(): Promise<ReadinessWords> {
  const meta = (await packMeta()) as unknown as { readiness?: Partial<ReadinessWords> };
  return { ...DEFAULT_WORDS, ...meta.readiness, refs: { ...meta.readiness?.refs } };
}

interface ControlRow {
  id: string; ref: string; title: string; theme: string; status: string; owner: string;
  maturity: number | null; target_maturity: number | null;
  evidence: number; fresh: number; last_result: string | null; last_test: string | null;
}

const DAY = 86_400_000;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

async function guideRecords(): Promise<Record<string, string>> {
  try {
    const g = await readPack<Record<string, { r?: string }>>("guide.json");
    return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.r ?? ""]));
  } catch {
    return {};
  }
}

/**
 * Theme names a reader would write: SAMA's "CYBER SECURITY LEADERSHIP AND
 * GOVERNANCE (3.1)" becomes "3.1 Leadership and governance". Names already in
 * ordinary case, such as "A.5 Organizational", are left alone.
 */
export function tidyTheme(v: string): string {
  if (v !== v.toUpperCase() || !/[A-Z]/.test(v)) return v;
  const num = /\(([\d.]+)\)\s*$/.exec(v)?.[1];
  const words = v.replace(/\([^)]*\)\s*$/, "").replace(/^CYBER SECURITY\s+/, "").trim().toLowerCase();
  const name = words.charAt(0).toUpperCase() + words.slice(1);
  return num ? `${num} ${name}` : name;
}

async function themeNames(): Promise<Record<string, string>> {
  try {
    const raw = await readPack<Record<string, string>>("themes.json");
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, tidyTheme(v)]));
  } catch {
    return {};
  }
}

/** Every control that applies, with what proves it and its last test. */
async function controlsInScope(): Promise<ControlRow[]> {
  const { rows } = await query<ControlRow>(
    `select c.id, c.ref, c.title, c.theme, c.status, c.owner, c.maturity, c.target_maturity,
            (select count(*) from evidence_controls ec where ec.control_id = c.id) as evidence,
            (select count(*) from evidence_controls ec join evidence e on e.id = ec.evidence_id
              where ec.control_id = c.id and e.collected_date >= $1) as fresh,
            (select t.result from control_tests t where t.control_id = c.id order by t.tested_on desc, t.created_at desc limit 1) as last_result,
            (select t.tested_on from control_tests t where t.control_id = c.id order by t.tested_on desc, t.created_at desc limit 1) as last_test
       from controls c where c.status <> 'not_applicable'`,
    [dayIso(-365)],
  );
  return rows;
}

/**
 * Whether a control counts as in place. In a product that scores maturity it
 * is at or above its target, the same rule the readiness figure and its
 * nightly history use; otherwise it is marked implemented.
 */
function inPlaceTest(scored: boolean): (c: ControlRow) => boolean {
  return scored
    ? (c) => c.maturity !== null && c.maturity >= (c.target_maturity ?? MATURITY_DEFAULT_TARGET)
    : (c) => c.status === "implemented";
}

export async function likelyFindings(): Promise<LikelyFinding[]> {
  const [records, names, order, words, scored] = await Promise.all([
    guideRecords(), themeNames(), themeOrder(), readinessWords(), hasFeature("maturity"),
  ]);
  const { auditorShort: who, refs } = words;
  const inPlace = inPlaceTest(scored);
  const yearAgo = dayIso(-365);
  const today = todayIso();
  const controls = await controlsInScope();
  const out: LikelyFinding[] = [];

  // A control that failed its own test: the auditor's sample would fail too.
  for (const c of controls) {
    if (c.last_result === "Fail" || c.last_result === "Partial") {
      out.push({
        id: `test:${c.ref}`, ref: c.ref,
        title: `${c.title}: last test ${c.last_result === "Fail" ? "failed" : "partly passed"} on ${c.last_test}`,
        label: c.last_result === "Fail" ? "Fail" : "Partial",
        says: `Your own test on ${c.last_test} found this was not fully working. An ${who} looking at the same thing would find the same.`,
        fix: "Fix the cause, then test it again and record the result.",
        action: { label: "Record a new test", route: "controls" }, weight: 1, controlId: c.id,
      });
    }
  }

  // Claimed in place with nothing to prove it, or only old proof.
  for (const c of controls.filter(inPlace)) {
    if (c.evidence === 0) {
      out.push({
        id: `noev:${c.ref}`, ref: c.ref, title: `${c.title}: ${scored ? "scored at target" : "marked in place"}, but nothing proves it`, label: "Gap",
        says: `The control is described as working, but there is no evidence an ${who} could look at.`,
        fix: records[c.ref] ? `Attach the records an ${who} asks for: ${records[c.ref]}` : "Attach evidence that shows it working.",
        action: { label: "Attach evidence", route: "evidence" }, weight: 1,
      });
    } else if (c.fresh === 0) {
      out.push({
        id: `stale:${c.ref}`, ref: c.ref, title: `${c.title}: all its evidence is over a year old or undated`, label: "Stale",
        says: "The evidence does not show the control working now.",
        fix: "Add evidence produced in the last year, with the date it was produced.",
        action: { label: "Add recent evidence", route: "evidence" }, weight: 1,
      });
    }
  }

  // Controls not in place yet, one line per theme so the list stays readable.
  const notYet = new Map<string, ControlRow[]>();
  for (const c of controls.filter((x) => !inPlace(x))) notYet.set(c.theme, [...(notYet.get(c.theme) ?? []), c]);
  for (const theme of [...notYet.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))) {
    const list = notYet.get(theme)!;
    const shown = list.slice(0, 6).map((c) => c.ref).join(", ");
    out.push({
      id: `notyet:${theme}`, ref: theme,
      title: `${plural(list.length, "control")} in ${names[theme] ?? theme} ${scored ? "below target or not scored yet" : "not in place yet"}`,
      label: "Gap",
      says: `There is no working control yet for ${shown}${list.length > 6 ? ` and ${list.length - 6} more` : ""}.`,
      fix: scored
        ? "Open each control: it says what is expected at each level. Score it honestly, then raise what falls short."
        : "Open each control: it says what to do and which records to keep. Mark it in progress when work starts.",
      action: { label: "Open the controls", route: "controls" }, weight: list.length,
    });
  }

  // Findings already raised and left past their date.
  if (refs.finding) {
    const { rows: overdue } = await query<{ seq: number; title: string; clause: string; due_date: string; owner: string }>(
      `select seq, title, clause, due_date, owner from findings
        where status <> 'Closed' and due_date is not null and due_date < $1 order by due_date`,
      [today],
    );
    for (const f of overdue) {
      out.push({
        id: `finding:${f.seq}`, ref: f.clause || refs.finding, title: `${f.title}: past its due date (${f.due_date})`, label: "Fail",
        says: `A known weakness was not fixed by the date set for it. An ${who} checks exactly this.`,
        fix: `Fix it, or agree a new date with ${f.owner || "its owner"} and record why it moved.`,
        action: { label: "Open the finding", route: "findings" }, weight: 1,
      });
    }
  }

  // Critical suppliers nobody has reviewed.
  if (refs.vendor) {
    const { rows: vendors } = await query<{ seq: number; name: string; assurance: string; assessed_date: string | null }>(
      `select seq, name, assurance, assessed_date from vendors
        where status <> 'Exited' and criticality = 'High'
          and (trim(assurance) = '' or assessed_date is null or assessed_date < $1) order by name`,
      [yearAgo],
    );
    for (const v of vendors) {
      out.push({
        id: `vendor:${v.seq}`, ref: refs.vendor,
        title: `${v.name}: ${v.assurance.trim() ? "not reviewed in the last 12 months" : "no assurance recorded"}`,
        label: "Stale",
        says: "A critical supplier's security was not reviewed in the last year. Having their certificate is not the same as reviewing it.",
        fix: "Look at their latest certificate or report, note anything it leaves out, and set the date you assessed them.",
        action: { label: "Review the supplier", route: "vendors" }, weight: 1,
      });
    }
  }

  // Policies that are not approved, or are past their review date.
  if (refs.policy) {
    const { rows: policies } = await query<{ seq: number; name: string; status: string; review_date: string | null }>(
      `select seq, name, status, review_date from policies
        where status <> 'Approved' or (review_date is not null and review_date < $1) order by name`,
      [today],
    );
    for (const p of policies) {
      const late = p.status === "Approved";
      out.push({
        id: `policy:${p.seq}`, ref: refs.policy, title: late ? `${p.name}: past its review date` : `${p.name}: not approved`,
        label: late ? "Stale" : "Gap",
        says: late ? "The policy was not reviewed when it said it would be." : "Policies have to be approved by management before they count.",
        fix: late ? "Review it, update the version if anything changed, and set the next review date." : "Send it to the approver and record the approval date.",
        action: { label: "Open the policy", route: "policies" }, weight: 1,
      });
    }
  }

  // The yearly checks: an internal audit, and a management review.
  const heldSince = async (kind: string): Promise<boolean> =>
    ((await query<{ n: number }>(
      "select count(*) as n from reviews where kind = $1 and status = 'Completed' and coalesce(held_date, planned_date) >= $2",
      [kind, yearAgo],
    )).rows[0]?.n ?? 0) > 0;
  if (refs.audit && !(await heldSince("Internal audit"))) {
    out.push({
      id: "yearly:audit", ref: refs.audit, title: "No internal audit held in the last 12 months", label: "Gap",
      says: "There is no record of an internal audit in the last year, so nobody has checked the programme works as written.",
      fix: "Plan one in Audits and reviews, hold it, and record what it found as findings.",
      action: { label: "Plan an internal audit", route: "reviews" }, weight: 1,
    });
  }
  if (refs.review && !(await heldSince("Management review"))) {
    out.push({
      id: "yearly:review", ref: refs.review, title: "No management review held in the last 12 months", label: "Gap",
      says: "Top management has not formally looked at how security is going in the last year.",
      fix: "Hold a management review, using the executive summary in Reports, and record it in Audits and reviews.",
      action: { label: "Plan a management review", route: "reviews" }, weight: 1,
    });
  }

  // Risks nobody owns, or nobody has decided what to do about.
  if (refs.risk) {
    const { rows } = await query<{ n: number }>(
      "select count(*) as n from risks where status <> 'Closed' and (trim(owner) = '' or trim(treatment) = '')",
    );
    const n = rows[0]?.n ?? 0;
    if (n > 0) {
      out.push({
        id: "risks:owned", ref: refs.risk, title: `${plural(n, "risk")} with no owner or no decision`, label: "Gap",
        says: "Every risk needs someone accountable and a decision about how it is treated.",
        fix: "Open each one, give it an owner, and choose how it is treated.",
        action: { label: "Open the risks", route: "risks" }, weight: n,
      });
    }
  }

  const rank: Record<FindingLabel, number> = { Fail: 0, Gap: 1, Partial: 2, Stale: 3 };
  return out.sort((a, b) => rank[a.label] - rank[b.label] || b.weight - a.weight);
}

async function quickWins(): Promise<QuickWin[]> {
  const n = async (sql: string, params: unknown[] = []): Promise<number> =>
    (await query<{ n: number }>(sql, params)).rows[0]?.n ?? 0;
  const wins: QuickWin[] = [
    { id: "owners", title: "Set an owner on controls that have none", minutes: 1,
      count: await n("select count(*) as n from controls where status <> 'not_applicable' and trim(owner) = ''"), route: "controls" },
    { id: "policyDates", title: "Add a review date to policies that have none", minutes: 1,
      count: await n("select count(*) as n from policies where review_date is null"), route: "policies" },
    { id: "evidenceDates", title: "Date evidence that has no date", minutes: 1,
      count: await n("select count(*) as n from evidence where collected_date is null"), route: "evidence" },
    { id: "vendorDates", title: "Record when you last assessed critical suppliers", minutes: 2,
      count: await n("select count(*) as n from vendors where status <> 'Exited' and criticality = 'High' and assessed_date is null"), route: "vendors" },
    { id: "findingOwners", title: "Give open findings an owner and a due date", minutes: 1,
      count: await n("select count(*) as n from findings where status <> 'Closed' and (trim(owner) = '' or due_date is null)"), route: "findings" },
  ];
  return wins.filter((w) => w.count > 0);
}

export interface KeyDate {
  title: string;
  date: string;
  ledBy: string;
  daysTo: number;
}

/** The next external audit planned in Audits and reviews: the date everything aims at. */
async function keyDate(): Promise<KeyDate | null> {
  const { rows } = await query<{ title: string; planned_date: string; led_by: string }>(
    `select title, planned_date, led_by from reviews
      where kind = 'External audit' and status in ('Planned', 'In progress') and planned_date is not null
      order by planned_date limit 1`,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    title: r.title, date: r.planned_date, ledBy: r.led_by,
    daysTo: Math.round((Date.parse(`${r.planned_date}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / DAY),
  };
}

// ── the Dashboard: where you stand, and where you are heading ────────────────

export interface ReadinessDashboard {
  readyPct: number;
  keyDate: KeyDate | null;
  /** The internal audit and management review planned before the key date, for the flight path. */
  milestones: { kind: string; date: string }[];
  /** Today's pace, as the date readiness reaches 100%. Null when there is no pace yet. */
  projectedReady: string | null;
  /** Readiness history, one point a day, oldest first. */
  trend: { day: string; pct: number }[];
  /** How the auditor would see each control in scope. */
  lens: { ready: number; questions: number; findings: number; total: number };
  team: { owner: string; total: number; implemented: number }[];
  weakest: { theme: string; name: string; pct: number; implemented: number; total: number } | null;
  weekChange: number;
}

export async function readinessDashboard(): Promise<ReadinessDashboard> {
  const [names, scored, tested] = await Promise.all([themeNames(), hasFeature("maturity"), hasFeature("controlTesting")]);
  const inPlace = inPlaceTest(scored);
  const controls = await controlsInScope();
  // The same figure as the nightly history: a scored product counts what has
  // been scored so far, so the forecast line and today's point agree.
  const counted = scored ? controls.filter((c) => c.maturity !== null) : controls;
  const implemented = counted.filter(inPlace);
  const readyPct = counted.length ? Math.round((implemented.length / counted.length) * 100) : 0;

  // The auditor's eye: shown cleanly, questioned, or written up. Where the
  // product does not record tests, a control is not marked down for having none.
  const lens = { ready: 0, questions: 0, findings: 0, total: controls.length };
  for (const c of controls) {
    const failing = c.last_result === "Fail" || c.last_result === "Partial";
    if (!inPlace(c) || failing || c.evidence === 0) lens.findings++;
    else if (c.fresh === 0 || (tested && !c.last_test)) lens.questions++;
    else lens.ready++;
  }

  const key = await keyDate();
  const { rows: planned } = await query<{ kind: string; date: string }>(
    `select kind, planned_date as date from reviews
      where kind in ('Internal audit', 'Management review') and status in ('Planned', 'In progress')
        and planned_date is not null and planned_date >= $1 ${key ? "and planned_date <= $2" : ""}
      order by planned_date`,
    key ? [todayIso(), key.date] : [todayIso()],
  );
  const milestones = planned.slice(0, 4);

  // Pace: the line through the last four weeks of the daily snapshots, plus today.
  const today = todayIso();
  const { rows: history } = await query<{ day: string; pct: number }>(
    "select day, pct from trend where day >= $1 order by day", [dayIso(-120)],
  );
  const trend = history.filter((h) => h.day !== today).concat([{ day: today, pct: readyPct }]);
  const recent = trend.filter((t) => t.day >= dayIso(-28));
  let projectedReady: string | null = null;
  if (readyPct >= 100) projectedReady = today;
  else if (recent.length >= 2) {
    const xs = recent.map((t) => Date.parse(`${t.day}T00:00:00Z`) / DAY);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = recent.reduce((a, t) => a + t.pct, 0) / recent.length;
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    const slope = den ? xs.reduce((a, x, i) => a + (x - mx) * (recent[i]!.pct - my), 0) / den : 0;
    if (slope > 0.01) projectedReady = dayIso(Math.ceil((100 - readyPct) / slope));
  }
  const weekAgo = trend.find((t) => t.day >= dayIso(-7));
  const weekChange = weekAgo ? readyPct - weekAgo.pct : 0;

  // Who is carrying it, and the weakest theme in scope.
  const byOwner = new Map<string, { owner: string; total: number; implemented: number }>();
  for (const c of controls) {
    const name = c.owner.trim() || "Unassigned";
    const o = byOwner.get(name) ?? { owner: name, total: 0, implemented: 0 };
    o.total++;
    if (inPlace(c)) o.implemented++;
    byOwner.set(name, o);
  }
  const team = [...byOwner.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  const byTheme = new Map<string, { total: number; implemented: number }>();
  for (const c of controls) {
    const t = byTheme.get(c.theme) ?? { total: 0, implemented: 0 };
    t.total++;
    if (inPlace(c)) t.implemented++;
    byTheme.set(c.theme, t);
  }
  const weakestEntry = [...byTheme.entries()].sort((a, b) => a[1].implemented / a[1].total - b[1].implemented / b[1].total)[0];
  const weakest = weakestEntry
    ? { theme: weakestEntry[0], name: names[weakestEntry[0]] ?? weakestEntry[0], pct: Math.round((weakestEntry[1].implemented / weakestEntry[1].total) * 100), ...weakestEntry[1] }
    : null;

  return { readyPct, keyDate: key, milestones, projectedReady, trend, lens, team, weakest, weekChange };
}

const bulkBody = z
  .object({
    theme: z.string().min(1).max(40),
    owner: z.string().max(200).optional(),
    outOfScope: z.string().max(2000).optional(),
  })
  .strict();

export async function readinessRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/readiness", { preHandler: canRead }, async () => {
    if (!(await hasFeature("readiness"))) throw notFound("This product has no readiness view.");
    const [found, wins, key, words] = await Promise.all([likelyFindings(), quickWins(), keyDate(), readinessWords()]);
    const fixFirst = [...found].sort((a, b) => b.weight - a.weight).slice(0, 3);
    return { ranAt: new Date().toISOString(), keyDate: key, words, findings: found, fixFirst, quickWins: wins };
  });

  app.get("/api/v1/readiness/dashboard", { preHandler: canRead }, async () => {
    if (!(await hasFeature("readiness"))) throw notFound("This product has no readiness dashboard.");
    return readinessDashboard();
  });

  /**
   * One owner for a whole theme, or a whole theme out of scope.
   *
   * The two decisions a team makes by theme rather than by control, and the
   * two that otherwise take dozens of clicks. One audit row per control, so
   * the trail still says what happened to each.
   */
  app.post("/api/v1/controls/bulk", { preHandler: canWrite }, async (request) => {
    if (!(await hasFeature("readiness"))) throw notFound("This product has no bulk update.");
    requireAuth(request);
    assertCanWrite(request.user.role);
    const body = bulkBody.parse(request.body);
    if (body.owner === undefined && body.outOfScope === undefined) throw badRequest("Say what to change: an owner, or out of scope with a reason.");
    if (body.outOfScope !== undefined && !body.outOfScope.trim()) throw badRequest("Say why this theme is out of scope.");
    // Only where the framework lets a whole area be excluded with a reason,
    // as the Statement of Applicability does. SAMA's domains all apply.
    if (body.outOfScope !== undefined && !(await hasFeature("statementOfApplicability"))) {
      throw badRequest("Every domain of this framework applies, so a whole one cannot be taken out of scope.");
    }

    const { rows } = await query<{ id: string; ref: string; owner: string; status: string; justification: string }>(
      "select id, ref, owner, status, justification from controls where theme = $1",
      [body.theme],
    );
    if (!rows.length) throw notFound("No such theme.");
    const targets = body.owner !== undefined ? rows.filter((r) => r.status !== "not_applicable") : rows;

    await withTransaction(async (tx) => {
      for (const r of targets) {
        if (body.owner !== undefined) {
          await tx.query("update controls set owner = $1 where id = $2", [body.owner.trim(), r.id]);
        } else {
          await tx.query("update controls set status = 'not_applicable', justification = $1 where id = $2", [body.outOfScope!.trim(), r.id]);
        }
      }
    });
    for (const r of targets) {
      await audit(request, {
        action: "Control updated",
        entity: "control",
        entityId: r.ref,
        before: { owner: r.owner, status: r.status, justification: r.justification },
        after: body.owner !== undefined
          ? { owner: body.owner.trim(), status: r.status, justification: r.justification }
          : { owner: r.owner, status: "not_applicable", justification: body.outOfScope!.trim() },
      });
    }
    return { updated: targets.length };
  });
}
