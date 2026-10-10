import type { Content } from "pdfmake/interfaces.js";
import { query } from "../db/pool.js";
import { MATURITY_DEFAULT_TARGET, product } from "../config.js";
import { hasFeature, packMeta, themeOrder } from "../lib/pack.js";
import { byThemeThenRef, compareRefs } from "../lib/refs.js";
import { buildJourney } from "../journey/journey.js";
import { loadBranding } from "../routes/settings.js";
import { buildDocument, renderPdf, kpiRow, table, safe, barChart, stackedBar, radar, heatMap } from "./pdf.js";
import { readPack } from "../lib/pack.js";

/**
 * The report catalogue.
 *
 * Each report says which feature flag it needs, so the list a customer sees is
 * the list their framework actually has. Every one is assembled from the same
 * tables the screens read, so a report and the dashboard can never disagree.
 */

export interface ReportSpec {
  id: string;
  title: string;
  description: string;
  /**
   * What to say instead when the framework is scored rather than ticked.
   *
   * A couple of reports change what they contain on a maturity pack - the gap
   * report lists what is below target rather than what is unimplemented - and
   * a description that still promises the old contents is simply wrong. Only
   * the reports that actually change need this.
   */
  scoredDescription?: string;
  /** Pack feature required for this report to be offered. */
  requires?: string;
  landscape?: boolean;
  build: () => Promise<Content[]>;
}

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  implemented: "Implemented",
  not_applicable: "Not applicable",
};

/**
 * "Function"/"Subcategory", "Family"/"Control", "Theme"/"Control" — the words
 * each framework uses. They live in the pack, not in the product constants,
 * because that is the file the API also seeded its controls from.
 */
async function labels(): Promise<{ theme: string; item: string }> {
  const meta = await packMeta();
  return { theme: meta.themeLabel, item: meta.itemLabel };
}

/**
 * Theme names a reader understands: "A.5 Organizational", not "A5". Packs that
 * write their names in capitals ("GOVERN (GV)") are put into ordinary case,
 * leaving what is in brackets alone.
 */
async function themeTitles(): Promise<Map<string, string>> {
  let names: Record<string, string> = {};
  try {
    names = await readPack<Record<string, string>>("themes.json");
  } catch {
    /* a pack without names keeps its keys */
  }
  const SMALL = new Set(["and", "of", "the", "for", "in", "to", "a", "an", "on"]);
  const tidy = (label: string): string => {
    if (label !== label.toUpperCase() || !/[A-Z]/.test(label)) return label;
    return label
      .split(/(\([^)]*\))/)
      .map((part) =>
        part.startsWith("(")
          ? part
          : part.toLowerCase().replace(/[a-z][a-z'-]*/g, (w, i: number) =>
              i > 0 && SMALL.has(w) ? w : w[0]!.toUpperCase() + w.slice(1)),
      )
      .join("");
  };
  return new Map(Object.entries(names).map(([k, v]) => [k, tidy(v)]));
}

const dash = (value: unknown): string => {
  const text = String(value ?? "").trim();
  return text === "" ? "-" : text;
};

interface ControlRow {
  ref: string;
  title: string;
  theme: string;
  status: string;
  owner: string;
  justification: string;
  attrs: string;
  updated_at: string;
  maturity: number | null;
  target_maturity: number | null;
}

/**
 * The 0-5 ladder, spelled out.
 *
 * Repeated from the web bundle rather than shared, because a report is read by
 * somebody who was not looking at the screen: the words have to travel with
 * the PDF. The web copy lives in apps/web/src/ui/format.ts and the two are
 * checked against each other by test/reports.e2e.test.ts.
 */
const MATURITY_LEVELS: { level: number; name: string; note: string }[] = [
  { level: 0, name: "Non-existent", note: "no documentation, no awareness" },
  { level: 1, name: "Ad-hoc", note: "done inconsistently, nothing defined" },
  { level: 2, name: "Repeatable but informal", note: "repeated, but not formally defined" },
  { level: 3, name: "Structured and formalised", note: "defined, approved, monitored" },
  { level: 4, name: "Managed and measurable", note: "effectiveness measured" },
  { level: 5, name: "Adaptive", note: "continuously improved" },
];

const levelName = (level: number | null): string =>
  level === null ? "Not assessed" : `${level} · ${MATURITY_LEVELS[level]?.name ?? ""}`.trim();

const targetOf = (c: ControlRow): number => c.target_maturity ?? MATURITY_DEFAULT_TARGET;

const controls = async (): Promise<ControlRow[]> => {
  const [rows, order] = await Promise.all([
    query<ControlRow>("select * from controls").then((r) => r.rows),
    themeOrder(),
  ]);
  return byThemeThenRef(rows, order);
};

const attrOf = (row: { attrs: string }, key: string): string =>
  String((JSON.parse(row.attrs || "{}") as Record<string, unknown>)[key] ?? "");

/**
 * The same arithmetic the summary endpoint does, so a report and the dashboard
 * cannot disagree. Unscored subdomains are left out of the averages rather
 * than counted as nought: "nobody has looked at this yet" is not the same
 * finding as "this does not exist", and treating it as one makes the first
 * week of an assessment look like a catastrophe.
 */
async function maturityStats(): Promise<{
  rows: ControlRow[];
  all: ControlRow[];
  total: number; excluded: number; scored: number; unscored: number;
  atTarget: number; atTargetPct: number; average: number;
  byLevel: number[];
  byTheme: Map<string, { scored: number; atTarget: number; total: number; sum: number }>;
}> {
  const all = await controls();
  // Ruled out is not the same as not yet looked at, so excluded items leave the
  // totals rather than sitting in "not assessed" forever.
  const rows = all.filter((c) => c.status !== "not_applicable");
  const byTheme = new Map<string, { scored: number; atTarget: number; total: number; sum: number }>();
  const byLevel = MATURITY_LEVELS.map(() => 0);
  let scored = 0;
  let atTarget = 0;
  let sum = 0;

  for (const c of rows) {
    const t = byTheme.get(c.theme) ?? { scored: 0, atTarget: 0, total: 0, sum: 0 };
    t.total++;
    if (c.maturity !== null) {
      scored++;
      sum += c.maturity;
      t.scored++;
      t.sum += c.maturity;
      byLevel[c.maturity] = (byLevel[c.maturity] ?? 0) + 1;
      if (c.maturity >= targetOf(c)) {
        atTarget++;
        t.atTarget++;
      }
    }
    byTheme.set(c.theme, t);
  }

  return {
    rows,
    all,
    total: rows.length,
    excluded: all.length - rows.length,
    scored,
    unscored: rows.length - scored,
    atTarget,
    atTargetPct: scored ? Math.round((atTarget / scored) * 100) : 0,
    average: scored ? Math.round((sum / scored) * 10) / 10 : 0,
    byLevel,
    byTheme,
  };
}

/** Readiness figures, computed the one way the whole product computes them. */
async function readiness(): Promise<{
  total: number; applicable: number; implemented: number; pct: number;
  byTheme: Map<string, { applicable: number; implemented: number; total: number }>;
}> {
  const rows = await controls();
  const byTheme = new Map<string, { applicable: number; implemented: number; total: number }>();
  let applicable = 0;
  let implemented = 0;

  for (const c of rows) {
    const t = byTheme.get(c.theme) ?? { applicable: 0, implemented: 0, total: 0 };
    t.total++;
    if (c.status !== "not_applicable") {
      t.applicable++;
      applicable++;
      if (c.status === "implemented") {
        t.implemented++;
        implemented++;
      }
    }
    byTheme.set(c.theme, t);
  }
  return {
    total: rows.length,
    applicable,
    implemented,
    pct: applicable ? Math.round((implemented / applicable) * 100) : 0,
    byTheme,
  };
}

// ── executive summary ────────────────────────────────────────────────────────
const executiveSummary: ReportSpec = {
  id: "executive-summary",
  title: "Executive summary",
  description:
    "Readiness, open risk and outstanding work on one or two pages. The one to take to a board meeting.",
  scoredDescription:
    "Maturity, open risk and outstanding work on one or two pages. The one to take to a board meeting.",
  async build() {
    const l = await labels();
    const scored = await hasFeature("maturity");
    const r = await readiness();
    const m = await maturityStats();
    const titles = await themeTitles();
    const name = (key: string): string => titles.get(key) ?? key;

    const all = await controls();
    const statusCount = (s: string) => all.filter((c) => c.status === s).length;

    const heat = await query<{ likelihood: number; impact: number; n: number }>(
      `select likelihood, impact, count(*) as n from risks where status <> 'Closed'
        group by likelihood, impact`,
    );
    const grid = [1, 2, 3, 4, 5].map(() => [0, 0, 0, 0, 0]);
    for (const h of heat.rows) {
      if (h.likelihood >= 1 && h.likelihood <= 5 && h.impact >= 1 && h.impact <= 5) {
        grid[h.likelihood - 1]![h.impact - 1] = h.n;
      }
    }

    const themeBars = scored
      ? [...m.byTheme.entries()].map(([theme, t]) => ({
          label: name(theme),
          pct: t.scored ? (t.atTarget / t.scored) * 100 : 0,
          note: t.scored ? `${t.atTarget} of ${t.scored} at target · avg ${(t.sum / t.scored).toFixed(1)}` : "not assessed",
        }))
      : [...r.byTheme.entries()].map(([theme, t]) => ({
          label: name(theme),
          pct: t.applicable ? (t.implemented / t.applicable) * 100 : 0,
          note: `${t.implemented} of ${t.applicable} in scope`,
        }));

    const risks = await query<{ n: number; critical: number; open: number }>(
      `select count(*) as n,
              sum(case when (likelihood * impact) >= 20 then 1 else 0 end) as critical,
              sum(case when status = 'Open' then 1 else 0 end) as open
         from risks`,
    );
    const rk = risks.rows[0] ?? { n: 0, critical: 0, open: 0 };

    const ev = await query<{ total: number; stale: number; gaps: number }>(
      `select (select count(*) from evidence) as total,
              (select count(*) from evidence
                where collected_date is null or collected_date <= date('now','-90 days')) as stale,
              (select count(*) from controls c
                where c.status = 'implemented'
                  and not exists (select 1 from evidence_controls ec where ec.control_id = c.id)) as gaps`,
    );
    const e = ev.rows[0] ?? { total: 0, stale: 0, gaps: 0 };

    const overdue = await query<{ tasks: number; findings: number }>(
      `select (select count(*) from tasks
                where status <> 'Done' and due_date is not null and due_date < date('now')) as tasks,
              (select count(*) from findings
                where status <> 'Closed' and due_date is not null and due_date < date('now')) as findings`,
    );
    const od = overdue.rows[0] ?? { tasks: 0, findings: 0 };

    const topRisks = await query<{
      seq: number; title: string; owner: string; status: string; inherent: number; residual: number;
    }>(
      `select seq, title, owner, status,
              (likelihood * impact) as inherent,
              (coalesce(res_likelihood, likelihood) * coalesce(res_impact, impact)) as residual
         from risks
        where status <> 'Closed'
        order by inherent desc, seq
        limit 10`,
    );

    return [
      /**
       * Four figures either way, but not the same four.
       *
       * A scored framework never sets a status, so "evidence gaps" - which
       * counts implemented items with nothing attached - would read nought
       * for ever and say so reassuringly. A figure that is always nought and
       * always comforting is worse on a board paper than no figure at all, so
       * the average takes its place.
       */
      scored
        ? kpiRow([
            {
              label: "At or above target",
              value: `${m.atTargetPct}%`,
              note: `${m.atTarget} of ${m.scored} assessed`,
            },
            {
              label: "Average maturity",
              value: m.average.toFixed(1),
              note: m.unscored
                ? `out of 5 · ${m.unscored} not yet assessed`
                : "out of 5, all assessed",
            },
            { label: "Open risks", value: String(rk.open ?? 0), note: `${rk.critical ?? 0} critical` },
            {
              label: "Overdue",
              value: String((od.tasks ?? 0) + (od.findings ?? 0)),
              note: "tasks and findings",
            },
          ])
        : kpiRow([
            { label: "Readiness", value: `${r.pct}%`, note: `${r.implemented} of ${r.applicable} in scope` },
            { label: "Open risks", value: String(rk.open ?? 0), note: `${rk.critical ?? 0} critical` },
            { label: "Evidence gaps", value: String(e.gaps), note: "implemented, nothing to prove it" },
            { label: "Overdue", value: String((od.tasks ?? 0) + (od.findings ?? 0)), note: "tasks and findings" },
          ]),

      scored
        ? { text: `At target, by ${l.theme.toLowerCase()}`, style: "h2" }
        : { text: `Readiness by ${l.theme.toLowerCase()}`, style: "h2" },
      barChart(themeBars),

      // A chart and its heading stay on the same page.
      {
        unbreakable: true,
        stack: [
          { text: "Coverage profile", style: "h2" },
          radar(themeBars.map((b) => ({ label: b.label, pct: b.pct }))),
        ],
      },

      scored
        ? { text: "Maturity levels", style: "h2" }
        : { text: `${l.item} status`, style: "h2" },
      scored
        ? stackedBar([
            ...MATURITY_LEVELS.map((lv, i) => ({
              label: `${lv.level} ${lv.name}`,
              value: m.byLevel[i] ?? 0,
              color: ["#b91c1c", "#ea580c", "#d97706", "#2457D6", "#0891b2", "#16a34a"][i]!,
            })),
            { label: "Not assessed", value: m.unscored, color: "#cbd5e1" },
          ])
        : stackedBar([
            { label: "Implemented", value: statusCount("implemented"), color: "#16a34a" },
            { label: "In progress", value: statusCount("in_progress"), color: "#d97706" },
            { label: "Not started", value: statusCount("not_started"), color: "#94a3b8" },
            { label: "Not applicable", value: statusCount("not_applicable"), color: "#e2e8f0" },
          ]),

      { unbreakable: true, stack: [{ text: "Risk heat map", style: "h2" }, heatMap(grid)] },

      { text: "Highest risks", style: "h2" },
      table(
        ["#", "Risk", "Owner", "Status", "Inherent", "Residual"],
        topRisks.rows.map((x) => [x.seq, x.title, dash(x.owner), x.status, x.inherent, x.residual]),
        [22, "*", 90, 60, 45, 45],
      ),

      {
        text: scored
          ? `Assessed against a target of level ${MATURITY_DEFAULT_TARGET} unless a ` +
            `${l.item.toLowerCase()} carries its own. ` +
            `Evidence: ${e.total} items recorded, ${e.stale} of them older than 90 days or undated.`
          : `Evidence: ${e.total} items recorded, ${e.stale} of them older than 90 days or undated. ` +
            `${e.gaps} implemented items have nothing attached to prove it.`,
        style: "small",
        margin: [0, 4, 0, 0],
      },
    ];
  },
};

// ── gap report ───────────────────────────────────────────────────────────────
const gapReport: ReportSpec = {
  id: "gap-report",
  title: "Gap report",
  description:
    "Everything in scope that is not yet implemented, with its owner and how far along it is.",
  scoredDescription:
    "Everything below its target level, worst gap first, plus anything nobody has assessed yet.",
  landscape: true,
  async build() {
    const l = await labels();
    const scored = await hasFeature("maturity");

    /**
     * What counts as a gap depends on how the framework is assessed. Ticked:
     * anything in scope that is not implemented. Scored: anything sitting
     * below its target level, worst first, because that is the order the
     * remediation plan gets written in. Unassessed items are listed too - not
     * knowing is its own gap - but they sort last, since there is no number
     * to rank them by.
     */
    const all = await controls();
    const rows = scored
      ? all
          .filter((c) => c.maturity === null || c.maturity < targetOf(c))
          .sort((a, b) => {
            const ga = a.maturity === null ? -1 : targetOf(a) - a.maturity;
            const gb = b.maturity === null ? -1 : targetOf(b) - b.maturity;
            return gb - ga || compareRefs(a.ref, b.ref);
          })
      : all.filter((c) => c.status !== "implemented" && c.status !== "not_applicable");

    const inProgress = rows.filter((c) => c.status === "in_progress").length;
    const unowned = rows.filter((c) => !c.owner.trim()).length;
    const unassessed = rows.filter((c) => c.maturity === null).length;
    const levelsShort = rows.reduce(
      (n, c) => n + (c.maturity === null ? 0 : targetOf(c) - c.maturity),
      0,
    );

    return [
      scored
        ? kpiRow([
            { label: "Below target", value: String(rows.length - unassessed), note: "assessed, short of target" },
            { label: "Not assessed", value: String(unassessed), note: "nobody has scored these" },
            { label: "Levels to climb", value: String(levelsShort), note: "total gap across all of them" },
            { label: "Unassigned", value: String(unowned), note: "nobody named" },
          ])
        : kpiRow([
            { label: "Open items", value: String(rows.length), note: "in scope, not implemented" },
            { label: "In progress", value: String(inProgress), note: "started" },
            { label: "Not started", value: String(rows.length - inProgress), note: "no work recorded" },
            { label: "Unassigned", value: String(unowned), note: "nobody named" },
          ]),
      { text: scored ? "Below target" : "Open items", style: "h2" },
      scored
        ? table(
            ["Ref", l.item, l.theme, "Current", "Target", "Gap", "Owner"],
            rows.map((c) => [
              c.ref,
              c.title,
              c.theme,
              levelName(c.maturity),
              String(targetOf(c)),
              c.maturity === null ? "-" : String(Math.max(0, targetOf(c) - c.maturity)),
              dash(c.owner),
            ]),
            [40, "*", 40, 126, 38, 28, 74],
          )
        : table(
            ["Ref", l.item, l.theme, "Status", "Owner", "Priority"],
            rows.map((c) => [
              c.ref,
              c.title,
              c.theme,
              STATUS_LABEL[c.status] ?? c.status,
              dash(c.owner),
              dash(attrOf(c, "priority")),
            ]),
            [58, "*", 46, 62, 90, 52],
          ),
    ];
  },
};

// -- readiness plan ----------------------------------------------------------
/**
 * The plan on paper.
 *
 * Written for a customer with no security team, so it is a to-do list first
 * and a status report second: what is left comes before what is finished,
 * because the reader is usually about to do the next bit rather than admire
 * the last bit.
 *
 * It says who decided each item. "Checked by the product" and "marked done by
 * Sara" are different claims, and a reader deciding whether to trust this
 * page deserves to know which is which.
 */
const readinessPlan: ReportSpec = {
  id: "readiness-plan",
  title: "Readiness plan",
  description:
    "The stages, what is done, what is left and who is doing it. The one to take to management when nobody has asked for a report yet.",
  requires: "journey",
  landscape: true,
  async build() {
    const plan = await buildJourney();

    const STATE_LABEL: Record<string, string> = {
      done: "Done",
      outstanding: "To do",
      not_applicable: "Excluded",
    };

    const outstanding = plan.stages.flatMap((stage) =>
      stage.tasks
        .filter((t) => t.state === "outstanding")
        .map((t) => [stage.name, t.title, t.do, t.detail || "-"]),
    );
    const excluded = plan.stages.flatMap((stage) =>
      stage.tasks
        .filter((t) => t.state === "not_applicable")
        .map((t) => [stage.name, t.title, t.reason || "-", t.actorName || "-"]),
    );

    return [
      kpiRow([
        {
          label: "Overall",
          value: `${plan.pct}%`,
          note: `${plan.done} of ${plan.applicable} steps done`,
        },
        {
          label: "Still to do",
          value: String(plan.applicable - plan.done),
          note: "across every stage",
        },
        {
          label: "Stages finished",
          value: `${plan.stages.filter((x) => x.complete).length} of ${plan.stages.length}`,
          note: "start to finish",
        },
        {
          label: "Suggested next",
          value: plan.suggested
            ? String(plan.stages.findIndex((x) => x.id === plan.suggested) + 1)
            : "-",
          note: plan.suggested
            ? (plan.stages.find((x) => x.id === plan.suggested)?.name ?? "")
            : "everything is done",
        },
      ]),

      { text: "Where each stage stands", style: "h2" },
      table(
        ["#", "Stage", "What it is for", "Done", "Of", "Progress"],
        plan.stages.map((stage, i) => [
          i + 1,
          stage.name,
          stage.aim,
          stage.done,
          stage.applicable,
          stage.applicable === 0 ? "nothing to do" : `${stage.pct}%`,
        ]),
        [18, 128, "*", 34, 26, 56],
      ),

      { text: "What is still to do", style: "h2" },
      table(["Stage", "Step", "What to do", "Where it stands"], outstanding, [110, 140, "*", 120]),

      { text: "Excluded, and why", style: "h2", pageBreak: "before" },
      table(["Stage", "Step", "Why it does not apply", "Excluded by"], excluded, [110, 140, "*", 90]),

      { text: "Everything, in order", style: "h2" },
      table(
        ["Stage", "Step", "State", "Decided by", "Detail"],
        plan.stages.flatMap((stage) =>
          stage.tasks.map((t) => [
            stage.name,
            t.title,
            STATE_LABEL[t.state] ?? t.state,
            t.state === "not_applicable"
              ? (t.actorName || "a person")
              : t.automatic
                ? "the product"
                : t.state === "done"
                  ? (t.actorName || "a person")
                  : "-",
            t.detail || t.reason || "-",
          ]),
        ),
        [110, 150, 50, 72, "*"],
      ),

      {
        text:
          "Steps marked \"the product\" are checked against this instance's own data every time this " +
          "report is produced. The rest are asserted by the person named, because no software can see " +
          "whether a board approved a policy or whether staff follow it.",
        style: "small",
        margin: [0, 4, 0, 0],
      },
    ];
  },
};

// -- maturity assessment -----------------------------------------------------
/**
 * The whole assessment on paper: every item, what it scored, what it should
 * score. This is the document a regulator or a client asks to see, so it lists
 * everything rather than only the gaps, and it carries the scale itself so a
 * reader who never saw the screen can still tell what a 3 means.
 */
const maturityAssessment: ReportSpec = {
  id: "maturity-assessment",
  title: "Maturity assessment",
  description:
    "Every item with its current level, its target and the gap between them, plus the scale they were scored against.",
  requires: "maturity",
  landscape: true,
  async build() {
    const l = await labels();
    const m = await maturityStats();

    return [
      kpiRow([
        {
          label: "At or above target",
          value: `${m.atTargetPct}%`,
          note: `${m.atTarget} of ${m.scored} assessed`,
        },
        { label: "Average maturity", value: m.average.toFixed(1), note: "out of 5" },
        { label: "Assessed", value: `${m.scored} of ${m.total}`, note: `${m.unscored} outstanding` },
        {
          label: "Default target",
          value: String(MATURITY_DEFAULT_TARGET),
          note: "unless the item says otherwise",
        },
      ]),

      { text: "The scale", style: "h2" },
      table(
        ["Level", "Name", "What it means"],
        MATURITY_LEVELS.map((x) => [String(x.level), x.name, x.note]),
        [38, 150, "*"],
      ),

      { text: `Spread across the ${l.item.toLowerCase()}s`, style: "h2" },
      table(
        ["Level", "Name", "Count", "Share of assessed"],
        MATURITY_LEVELS.map((x) => [
          String(x.level),
          x.name,
          String(m.byLevel[x.level] ?? 0),
          m.scored ? `${Math.round(((m.byLevel[x.level] ?? 0) / m.scored) * 100)}%` : "-",
        ]),
        [38, 150, 50, "*"],
      ),

      { text: `By ${l.theme.toLowerCase()}`, style: "h2" },
      table(
        [l.theme, "Assessed", "At target", "Average", "Not assessed"],
        [...m.byTheme.entries()].map(([theme, t]) => [
          theme,
          t.scored,
          `${t.scored ? Math.round((t.atTarget / t.scored) * 100) : 0}%`,
          t.scored ? (t.sum / t.scored).toFixed(1) : "-",
          t.total - t.scored,
        ]),
        ["*", 55, 60, 55, 70],
      ),

      { text: "Full assessment", style: "h2", pageBreak: "before" },
      table(
        ["Ref", l.item, l.theme, "Current", "Target", "Gap", "Owner"],
        m.rows.map((c) => [
          c.ref,
          c.title,
          c.theme,
          levelName(c.maturity),
          String(targetOf(c)),
          c.maturity === null ? "-" : String(Math.max(0, targetOf(c) - c.maturity)),
          dash(c.owner),
        ]),
        [40, "*", 40, 126, 38, 28, 74],
      ),
    ];
  },
};

// ── risk register ────────────────────────────────────────────────────────────
const riskRegister: ReportSpec = {
  id: "risk-register",
  title: "Risk register",
  description: "Every risk with its scores, treatment, owner and current status.",
  landscape: true,
  async build() {
    const { rows } = await query<{
      seq: number; title: string; category: string; owner: string; treatment: string;
      status: string; likelihood: number; impact: number; inherent: number; residual: number;
      accepted_by: string | null;
    }>(
      `select seq, title, category, owner, treatment, status, likelihood, impact,
              (likelihood * impact) as inherent,
              (coalesce(res_likelihood, likelihood) * coalesce(res_impact, impact)) as residual,
              accepted_by
         from risks
        order by (likelihood * impact) desc, seq`,
    );

    const band = (n: number): string => (n >= 20 ? "Critical" : n >= 12 ? "Elevated" : "Acceptable");

    return [
      kpiRow([
        { label: "Risks", value: String(rows.length), note: "in the register" },
        { label: "Critical", value: String(rows.filter((r) => r.inherent >= 20).length), note: "inherent 20 or more" },
        { label: "Open", value: String(rows.filter((r) => r.status === "Open").length), note: "not yet treated" },
        { label: "Accepted", value: String(rows.filter((r) => r.status === "Accepted").length), note: "formally accepted" },
      ]),
      { text: "Register", style: "h2" },
      table(
        ["#", "Risk", "Category", "Owner", "Treatment", "Status", "L", "I", "Inherent", "Residual", "Band"],
        rows.map((r) => [
          r.seq, r.title, dash(r.category), dash(r.owner), r.treatment, r.status,
          r.likelihood, r.impact, r.inherent, r.residual, band(r.inherent),
        ]),
        [20, "*", 66, 74, 56, 50, 16, 16, 42, 42, 52],
      ),
      {
        text: rows.some((r) => r.status === "Accepted" && !r.accepted_by)
          ? "Warning: at least one accepted risk does not name who accepted it."
          : "",
        style: "small",
        color: "#b91c1c",
      },
    ];
  },
};

// ── evidence register ────────────────────────────────────────────────────────
const evidenceRegister: ReportSpec = {
  id: "evidence-register",
  title: "Evidence register",
  description:
    "What has been collected, how recent it is, and which controls each item supports.",
  landscape: true,
  async build() {
    const { rows } = await query<{
      name: string; type: string; owner: string; collected_date: string | null;
      next_review: string | null; freshness: string; refs: string;
    }>(
      `select e.name, e.type, e.owner, e.collected_date, e.next_review,
              case
                when e.collected_date is null then 'No date'
                when e.collected_date > date('now','-30 days') then 'Fresh'
                when e.collected_date > date('now','-60 days') then 'Ageing'
                when e.collected_date > date('now','-90 days') then 'Due'
                else 'Stale'
              end as freshness,
              coalesce((select group_concat(c.ref, ', ')
                          from evidence_controls ec
                          join controls c on c.id = ec.control_id
                         where ec.evidence_id = e.id), '') as refs
         from evidence e
        order by e.collected_date desc, e.name`,
    );

    const count = (f: string): number => rows.filter((r) => r.freshness === f).length;

    return [
      kpiRow([
        { label: "Evidence", value: String(rows.length), note: "items recorded" },
        { label: "Fresh", value: String(count("Fresh")), note: "within 30 days" },
        { label: "Due or stale", value: String(count("Due") + count("Stale")), note: "older than 60 days" },
        { label: "Unlinked", value: String(rows.filter((r) => !r.refs).length), note: "proves nothing yet" },
      ]),
      { text: "Register", style: "h2" },
      table(
        ["Evidence", "Type", "Owner", "Collected", "Age", "Next review", "Supports"],
        rows.map((r) => [
          r.name, r.type, dash(r.owner), dash(r.collected_date), r.freshness,
          dash(r.next_review), dash(r.refs),
        ]),
        ["*", 58, 74, 58, 44, 58, 150],
      ),
    ];
  },
};

// ── statement of applicability ───────────────────────────────────────────────
const statementOfApplicability: ReportSpec = {
  id: "statement-of-applicability",
  title: "Statement of Applicability",
  description:
    "Every control, whether it applies, why, and its implementation status. The document a certification auditor asks for first.",
  requires: "statementOfApplicability",
  landscape: true,
  async build() {
    const l = await labels();
    const rows = await controls();
    const excluded = rows.filter((c) => c.status === "not_applicable");
    const unjustified = excluded.filter((c) => !c.justification.trim());

    const { rows: prog } = await query<{ scope: string; methodology: string }>(
      "select scope, methodology from programme where id = 1",
    );
    const scope = prog[0]?.scope?.trim() ?? "";
    const methodology = prog[0]?.methodology?.trim() ?? "";

    const preface: Content[] = [
      kpiRow([
        { label: "Applicable", value: String(rows.length - excluded.length), note: `of ${rows.length} controls` },
        { label: "Excluded", value: String(excluded.length), note: "with a stated reason" },
        {
          label: "Implemented",
          value: String(rows.filter((c) => c.status === "implemented").length),
          note: "of the applicable controls",
        },
        { label: "Missing reason", value: String(unjustified.length), note: "exclusions to explain" },
      ]),
    ];

    if (scope || methodology) {
      preface.push({ text: "Scope and methodology", style: "h2" });
      if (scope) {
        preface.push({ text: safe(scope), style: "td", margin: [0, 0, 0, 6] });
      }
      if (methodology) {
        preface.push({ text: safe(methodology), style: "td", margin: [0, 0, 0, 4] });
      }
    }

    if (unjustified.length) {
      preface.push({
        text:
          `${unjustified.length} excluded control(s) have no stated reason. ` +
          "An assessor will ask why each does not apply.",
        style: "small",
        color: "#b91c1c",
        margin: [0, 6, 0, 0],
      });
    }

    return [
      ...preface,
      { text: "Statement", style: "h2" },
      table(
        ["Ref", "Control", l.theme, "Applies", "Status", "Justification", "Owner"],
        rows.map((c) => [
          c.ref,
          c.title,
          c.theme,
          c.status === "not_applicable" ? "No" : "Yes",
          STATUS_LABEL[c.status] ?? c.status,
          c.justification.trim() ||
            (c.status === "not_applicable" ? "NO REASON GIVEN" : "-"),
          dash(c.owner),
        ]),
        [50, "*", 58, 40, 62, 190, 74],
      ),
    ];
  },
};

// ── baseline and tailoring ───────────────────────────────────────────────────
const baselineReport: ReportSpec = {
  id: "baseline-tailoring",
  title: "Baseline and tailoring",
  description:
    "Which controls the chosen baseline selected, how each was tailored, and the parameters that have been defined.",
  requires: "baselines",
  landscape: true,
  async build() {
    const rows = await controls();
    const inScope = rows.filter((c) => c.status !== "not_applicable");

    const { rows: prog } = await query<{ attrs: string }>(
      "select attrs from programme where id = 1",
    );
    const attrs = JSON.parse(prog[0]?.attrs ?? "{}") as Record<string, unknown>;
    const level = String(attrs["baseline"] ?? "none selected");
    const system = (attrs["system"] as Record<string, string> | undefined) ?? {};

    const withParams = inScope.filter(
      (c) => Object.keys(JSON.parse(c.attrs || "{}")["paramValues"] ?? {}).length > 0,
    ).length;

    return [
      kpiRow([
        { label: "Baseline", value: level, note: "SP 800-53B" },
        { label: "In scope", value: String(inScope.length), note: `of ${rows.length} controls` },
        { label: "Parameters set", value: String(withParams), note: "controls tailored" },
        {
          label: "Implemented",
          value: String(inScope.filter((c) => c.status === "implemented").length),
          note: "of the selected controls",
        },
      ]),
      {
        text: system["name"]
          ? safe(`System: ${system["name"]}${system["ao"] ? ` — authorising official ${system["ao"]}` : ""}`)
          : "No system details recorded.",
        style: "small",
        margin: [0, 4, 0, 0],
      },
      { text: "Selected controls", style: "h2" },
      table(
        ["Ref", "Control", "Family", "Status", "Origination", "Owner", "Parameters"],
        inScope.map((c) => {
          const a = JSON.parse(c.attrs || "{}") as Record<string, unknown>;
          const params = Object.keys((a["paramValues"] as object) ?? {}).length;
          return [
            c.ref,
            c.title,
            c.theme,
            STATUS_LABEL[c.status] ?? c.status,
            dash(a["origination"]),
            dash(c.owner),
            params ? `${params} set` : "-",
          ];
        }),
        [58, "*", 40, 62, 74, 78, 54],
      ),
    ];
  },
};

// ── management review pack ───────────────────────────────────────────────────
/**
 * The inputs clause 9.3 lists, gathered into the document the meeting reads.
 *
 * Every number in it comes from the same queries the screens use, so the pack
 * cannot quietly disagree with the product it was produced from. What it does
 * not do is decide anything: the decisions are minuted afterwards, in Audits
 * and reviews, which is where an auditor looks for them.
 */
const managementReviewPack: ReportSpec = {
  id: "management-review-pack",
  title: "Management review pack",
  description:
    "What a management review reads: objectives, risks, incidents, findings, audits, supplier assurance and where the controls stand.",
  requires: "ismsRegisters",
  landscape: true,
  async build() {
    const one = async <T>(sql: string): Promise<T[]> => (await query<T>(sql)).rows;

    const [controls, objectives, risks, incidents, findings, reviews, vendors, evidence] =
      await Promise.all([
        one<{ status: string; n: number }>(
          "select status, count(*) as n from controls group by status",
        ),
        one<{
          title: string; measure: string; target: string; owner: string;
          due_date: string | null; status: string;
        }>("select title, measure, target, owner, due_date, status from objectives order by status, due_date"),
        one<{ title: string; score: number; treatment: string; owner: string; status: string }>(
          `select title, likelihood * impact as score, treatment, owner, status
             from risks where status <> 'Closed' order by likelihood * impact desc limit 15`,
        ),
        one<{ title: string; severity: string; status: string; detected_date: string | null }>(
          `select title, severity, status, detected_date from incidents
            where detected_date is null or detected_date > date('now','-365 days')
            order by detected_date desc limit 20`,
        ),
        one<{ title: string; type: string; status: string; owner: string; due_date: string | null }>(
          "select title, type, status, owner, due_date from findings where status <> 'Closed' order by due_date",
        ),
        one<{
          title: string; kind: string; status: string;
          planned_date: string | null; held_date: string | null; outcome: string;
        }>(
          `select title, kind, status, planned_date, held_date, outcome from reviews
            order by coalesce(held_date, planned_date) desc limit 12`,
        ),
        one<{ name: string; criticality: string; status: string; assurance: string; review_date: string | null }>(
          `select name, criticality, status, assurance, review_date from vendors
            where status <> 'Exited' order by criticality = 'High' desc, name`,
        ),
        one<{ n: number; stale: number }>(
          `select count(*) as n,
                  sum(case when collected_date is null or collected_date <= date('now','-90 days')
                           then 1 else 0 end) as stale
             from evidence`,
        ),
      ]);

    const count = (status: string): number => controls.find((c) => c.status === status)?.n ?? 0;
    const total = controls.reduce((sum, c) => sum + c.n, 0);
    const applicable = total - count("not_applicable");
    const done = applicable > 0 ? Math.round((count("implemented") / applicable) * 100) : 0;
    const { item } = await labels();
    // A scored framework never sets a status, so "implemented" would read nought
    // for ever. It reports maturity instead, the way its other reports do.
    const scored = await hasFeature("maturity");
    const m = scored ? await maturityStats() : null;

    return [
      kpiRow([
        m
          ? { label: "At or above target", value: `${m.atTargetPct}%`, note: `${m.atTarget} of ${m.scored} assessed` }
          : { label: "Implemented", value: `${done}%`, note: `of ${applicable} that apply` },
        { label: "Open risks", value: String(risks.length), note: "top fifteen listed" },
        { label: "Open findings", value: String(findings.length), note: "nonconformities and observations" },
        { label: "Stale evidence", value: String(evidence[0]?.stale ?? 0), note: `of ${evidence[0]?.n ?? 0} items` },
      ]),

      { text: "Audits and reviews, and what came of them", style: "h2" },
      table(
        ["Audit or review", "Type", "Status", "Planned", "Held", "Outcome"],
        reviews.length
          ? reviews.map((r) => [r.title, r.kind, r.status, dash(r.planned_date), dash(r.held_date), dash(r.outcome)])
          : [["None recorded", "-", "-", "-", "-", "-"]],
        [130, 86, 58, 58, 58, "*"],
      ),

      { text: "Security objectives", style: "h2" },
      table(
        ["Objective", "How it is measured", "Target", "Owner", "Due", "Status"],
        objectives.length
          ? objectives.map((o) => [o.title, dash(o.measure), dash(o.target), dash(o.owner), dash(o.due_date), o.status])
          : [["None set", "-", "-", "-", "-", "-"]],
        ["*", 130, 70, 78, 58, 58],
      ),

      { text: "Risks carrying the most weight", style: "h2" },
      table(
        ["Risk", "Score", "Treatment", "Owner", "Status"],
        risks.length
          ? risks.map((r) => [r.title, String(r.score), r.treatment, dash(r.owner), r.status])
          : [["None recorded", "-", "-", "-", "-"]],
        ["*", 42, 66, 90, 58],
      ),

      { text: "Incidents in the last year", style: "h2" },
      table(
        ["Incident", "Severity", "Status", "Detected"],
        incidents.length
          ? incidents.map((i) => [i.title, i.severity, i.status, dash(i.detected_date)])
          : [["None recorded", "-", "-", "-"]],
        ["*", 58, 72, 58],
      ),

      { text: "Nonconformities and findings still open", style: "h2" },
      table(
        ["Finding", "Type", "Status", "Owner", "Due"],
        findings.length
          ? findings.map((f) => [f.title, f.type, f.status, dash(f.owner), dash(f.due_date)])
          : [["None open", "-", "-", "-", "-"]],
        ["*", 110, 58, 90, 58],
      ),

      { text: "Suppliers and the assurance they gave", style: "h2" },
      table(
        ["Supplier", "Criticality", "Status", "Assurance", "Next review"],
        vendors.length
          ? vendors.map((v) => [v.name, v.criticality, v.status, dash(v.assurance), dash(v.review_date)])
          : [["None recorded", "-", "-", "-", "-"]],
        ["*", 58, 66, 150, 62],
      ),

      { text: `Where the ${item.toLowerCase()}s stand`, style: "h2" },
      m
        ? table(
            [...MATURITY_LEVELS.map((lv) => `${lv.level} ${lv.name}`), "Not assessed"],
            [[...MATURITY_LEVELS.map((lv) => String(m.byLevel[lv.level] ?? 0)), String(m.unscored)]],
            ["*", "*", "*", "*", "*", "*", "*"],
          )
        : table(
            ["Not started", "In progress", "Implemented", "Not applicable"],
            [[
              String(count("not_started")), String(count("in_progress")),
              String(count("implemented")), String(count("not_applicable")),
            ]],
            ["*", "*", "*", "*"],
          ),
    ];
  },
};

// ── document control list ────────────────────────────────────────────────────
/**
 * Every controlled document, its version, who approved it and when it is next
 * reviewed. Clause 7.5 on one page, and the list an auditor uses to choose
 * which document to ask for.
 */
const documentControlList: ReportSpec = {
  id: "document-control-list",
  title: "Document control list",
  description:
    "Every policy and procedure, with its version, owner, approval, review date and the versions it has been through.",
  requires: "ismsRegisters",
  landscape: true,
  async build() {
    const { rows } = await query<{
      name: string; version: string; status: string; owner: string; approver: string;
      approval_date: string | null; review_date: string | null; refs: string; history: number;
      acknowledgements: number;
    }>(
      `select p.name, p.version, p.status, p.owner, p.approver, p.approval_date, p.review_date,
              coalesce((select group_concat(c.ref, ', ')
                          from policy_controls pc
                          join controls c on c.id = pc.control_id
                         where pc.policy_id = p.id), '') as refs,
              (select count(*) from policy_versions v where v.policy_id = p.id) as history,
              (select count(*) from policy_acknowledgements a
                where a.policy_id = p.id and a.version = p.version) as acknowledgements
         from policies p
        order by p.name`,
    );

    const today = new Date().toISOString().slice(0, 10);
    const approved = rows.filter((r) => r.status === "Approved").length;
    const overdue = rows.filter((r) => r.review_date && r.review_date < today).length;

    return [
      kpiRow([
        { label: "Documents", value: String(rows.length), note: "under control" },
        { label: "Approved", value: String(approved), note: `of ${rows.length}` },
        { label: "Review overdue", value: String(overdue), note: "past their review date" },
        { label: "Unlinked", value: String(rows.filter((r) => !r.refs).length), note: "not tied to a control" },
      ]),
      { text: "Documents", style: "h2" },
      table(
        ["Document", "Version", "Status", "Owner", "Approved by", "Approved", "Next review",
         "Earlier versions", "Read this version", "Covers"],
        rows.length
          ? rows.map((r) => [
              r.name, r.version, r.status, dash(r.owner), dash(r.approver),
              dash(r.approval_date), dash(r.review_date), String(r.history),
              r.acknowledgements ? String(r.acknowledgements) : "-", dash(r.refs),
            ])
          : [["None recorded", "-", "-", "-", "-", "-", "-", "-", "-", "-"]],
        ["*", 44, 54, 68, 68, 52, 56, 42, 50, 96],
      ),
    ];
  },
};

export const REPORTS: ReportSpec[] = [
  readinessPlan,
  executiveSummary,
  maturityAssessment,
  gapReport,
  statementOfApplicability,
  baselineReport,
  riskRegister,
  evidenceRegister,
  managementReviewPack,
  documentControlList,
];

/** Builds one report to a PDF buffer. */
export async function renderReport(spec: ReportSpec, generatedBy: string): Promise<Buffer> {
  const [body, branding, pack] = await Promise.all([
    spec.build(),
    loadBranding(),
    packMeta(),
  ]);
  return renderPdf(
    buildDocument(
      {
        title: spec.title,
        subtitle: `${product.name} — ${product.framework}`,
        generatedBy,
        edition: pack.edition,
        disclaimer: pack.disclaimer,
        contact: pack.contact,
        landscape: spec.landscape ?? false,
        clientLogo: branding.logo
          ? { kind: branding.logo.kind, data: branding.logo.data }
          : null,
      },
      body,
    ),
  );
}

