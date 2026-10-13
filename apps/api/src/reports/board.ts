import type { Content, TDocumentDefinitions } from "pdfmake/interfaces.js";
import { query } from "../db/pool.js";
import { MATURITY_DEFAULT_TARGET, product } from "../config.js";
import { packMeta, readPack, themeOrder } from "../lib/pack.js";
import { loadBranding, loadOrganisation } from "../routes/settings.js";
import { boardLogo, renderPdf, safe } from "./pdf.js";

/**
 * The executive summary, written for a board.
 *
 * The plain report lists figures; a board member reading it has to work out
 * what they mean. This one says it: a verdict in a sentence, what changed since
 * the last paper, the decisions the committee is being asked for, and what
 * happens in the next ninety days. Two pages, laid out like the rest of the
 * papers in a board pack rather than like an export.
 *
 * Everything on it is computed from the same tables the screens read. The only
 * thing it stores is a small snapshot of its own headline figures each time it
 * is produced, because "since last month" needs a last month and nothing else
 * in the product keeps one.
 */

// ── palette ──────────────────────────────────────────────────────────────────
const NAVY = "#0f1c36";
const NAVY2 = "#1b2c52";
const GOLD = "#c39a4a";
const GOLD_LIGHT = "#e3c483";
const BLUE = "#2f5bd3";
const INK = "#101828";
const INK2 = "#475467";
const MUTED = "#8a94a6";
const LINE = "#e6e9f0";
const SOFT = "#f6f7fa";
const BAND_TEXT = "#c9d3ea";
const BAND_MUTED = "#8fa0c4";
const TONE = {
  up: { fg: "#1f8a4c", bg: "#e6f4ec" },
  down: { fg: "#b42318", bg: "#fcebea" },
  warn: { fg: "#c27a0e", bg: "#fbf1df" },
  flat: { fg: INK2, bg: SOFT },
} as const;
type Tone = keyof typeof TONE;

const SERIF = "Times";
const PAGE_W = 595.28;
const SIDE = 42;
const WIDTH = PAGE_W - 2 * SIDE;
const BAND_H = 196;

type M = [number, number, number, number];
const x = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── the figures ──────────────────────────────────────────────────────────────

interface Snapshot {
  day: string;
  headline: number;
  average: number | null;
  critical: number;
  overdue: number;
  atTarget: number;
  evidence: number;
}

interface Area { ref: string; name: string; level: number; target: number }

interface Decision { kind: string; title: string; why: string; recommend: string; riskSeq?: number }

interface RiskRow {
  id: string; seq: number; title: string; owner: string; status: string; treatment: string;
  likelihood: number; impact: number; res_likelihood: number | null; res_impact: number | null;
  accepted_by: string | null; review_date: string | null; created_at: string;
}

const today = (): string => new Date().toISOString().slice(0, 10);
const addDays = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const longDate = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const initials = (name: string): string =>
  name.trim().split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !["of", "and", "the"].includes(w.toLowerCase()))
    .slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "-";

/** The words a reader uses for a group of controls, by framework. */
async function themeNames(): Promise<Map<string, string>> {
  try {
    const names = await readPack<Record<string, string>>("themes.json");
    // SAMA writes "CYBER SECURITY LEADERSHIP AND GOVERNANCE (3.1)"; a board
    // paper reads better as "3.1 Leadership and governance".
    const tidy = (v: string): string => {
      if (v !== v.toUpperCase()) return v;
      const num = /\(([\d.]+)\)\s*$/.exec(v)?.[1];
      const words = v.replace(/\([^)]*\)\s*$/, "").replace(/^CYBER SECURITY\s+/, "").trim().toLowerCase();
      const name = words.charAt(0).toUpperCase() + words.slice(1);
      return num ? `${num} ${name}` : name;
    };
    return new Map(Object.entries(names).map(([k, v]) => [k, tidy(v)]));
  } catch {
    return new Map();
  }
}

/** Snapshots of earlier board papers, oldest first. */
async function loadSnapshots(): Promise<Snapshot[]> {
  const { rows } = await query<{ value: string }>("select value from settings where key = 'board_snapshots'");
  try {
    const list = JSON.parse(rows[0]?.value ?? "[]") as Snapshot[];
    return Array.isArray(list) ? list.sort((a, b) => a.day.localeCompare(b.day)) : [];
  } catch {
    return [];
  }
}

/** Keeps today's figures, one per day, the last two years at most. */
async function saveSnapshot(list: Snapshot[], now: Snapshot): Promise<void> {
  const kept = [...list.filter((s) => s.day !== now.day), now].sort((a, b) => a.day.localeCompare(b.day)).slice(-24);
  await query(
    `insert into settings (key, value) values ('board_snapshots', $1)
     on conflict (key) do update set value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    [JSON.stringify(kept)],
  );
}

async function gather() {
  const [order, names, pack] = await Promise.all([themeOrder(), themeNames(), packMeta()]);
  const scored = Boolean(pack.features?.["maturity"]);
  const { rows: controls } = await query<{
    id: string; ref: string; title: string; theme: string; parent_ref: string | null; status: string;
    maturity: number | null; target_maturity: number | null;
  }>("select id, ref, title, theme, parent_ref, status, maturity, target_maturity from controls");
  const inScope = controls.filter((c) => c.status !== "not_applicable");
  const target = (c: { target_maturity: number | null }): number => c.target_maturity ?? MATURITY_DEFAULT_TARGET;
  const parents = new Set(controls.map((c) => c.parent_ref).filter((r): r is string => Boolean(r)));
  // A subdomain heading is not itself a control to score, where it has children.
  const counted = inScope.filter((c) => !parents.has(c.ref));

  // Headline: share at target (scored) or share implemented (ticked).
  const isGood = (c: (typeof counted)[number]): boolean =>
    scored ? c.maturity !== null && c.maturity >= target(c) : c.status === "implemented";
  const assessed = scored ? counted.filter((c) => c.maturity !== null) : counted;
  const good = assessed.filter(isGood).length;
  const headline = assessed.length ? Math.round((good / assessed.length) * 100) : 0;
  const levels = counted.filter((c) => c.maturity !== null).map((c) => c.maturity as number);
  const average = levels.length ? Math.round((levels.reduce((a, b) => a + b, 0) / levels.length) * 10) / 10 : null;

  const themes = order.filter((t) => counted.some((c) => c.theme === t)).map((t) => {
    const mine = counted.filter((c) => c.theme === t);
    const den = scored ? mine.filter((c) => c.maturity !== null).length : mine.length;
    const num = (scored ? mine.filter((c) => c.maturity !== null) : mine).filter(isGood).length;
    return { key: t, name: names.get(t) ?? t, count: mine.length, num, den, pct: den ? Math.round((num / den) * 100) : 0 };
  });

  // Subdomains, for a scored framework: the average level of their children.
  const areas: Area[] = [];
  if (scored) {
    const byParent = new Map<string, typeof counted>();
    for (const c of counted) {
      const key = c.parent_ref ?? c.ref;
      byParent.set(key, [...(byParent.get(key) ?? []), c]);
    }
    for (const [ref, kids] of byParent) {
      const marked = kids.filter((k) => k.maturity !== null);
      if (!marked.length) continue;
      const head = controls.find((c) => c.ref === ref);
      areas.push({
        ref,
        name: (head?.title ?? kids[0]!.title).replace(/^Cyber Security (?=\S)/, "").replace(/^in /, "Security in "),
        level: Math.round((marked.reduce((a, k) => a + (k.maturity as number), 0) / marked.length) * 10) / 10,
        target: Math.max(...kids.map(target)),
      });
    }
  }

  const { rows: risks } = await query<RiskRow>(
    `select id, seq, title, owner, status, treatment, likelihood, impact, res_likelihood, res_impact,
            accepted_by, review_date, created_at from risks where status <> 'Closed'`,
  );
  const after = (r: RiskRow): number => (r.res_likelihood ?? r.likelihood) * (r.res_impact ?? r.impact);
  const before = (r: RiskRow): number => r.likelihood * r.impact;
  const { rows: links } = await query<{ risk_id: string; status: string }>(
    `select rc.risk_id, c.status from risk_controls rc join controls c on c.id = rc.control_id`,
  );

  const d = today();
  const { rows: od } = await query<{ tasks: number; findings: number }>(
    `select (select count(*) from tasks where status <> 'Done' and due_date is not null and due_date < $1) as tasks,
            (select count(*) from findings where status <> 'Closed' and due_date is not null and due_date < $1) as findings`,
    [d],
  );
  const { rows: ev } = await query<{ total: number; stale: number; bare: number; policies: number }>(
    `select (select count(*) from evidence) as total,
            (select count(*) from evidence where collected_date is null or collected_date <= date('now','-90 days')) as stale,
            (select count(*) from controls c where c.status = 'implemented'
               and not exists (select 1 from evidence_controls ec where ec.control_id = c.id)) as bare,
            (select count(*) from policies where review_date is not null and review_date < $1) as policies`,
    [d],
  );

  return {
    scored, pack, controls, counted, themes, areas, headline, good, assessed: assessed.length, average,
    notStarted: counted.filter((c) => c.status === "not_started").length,
    risks, links, before, after,
    overdueTasks: od[0]?.tasks ?? 0, overdueFindings: od[0]?.findings ?? 0,
    evidence: ev[0]?.total ?? 0, staleEvidence: ev[0]?.stale ?? 0, bareControls: ev[0]?.bare ?? 0,
    policiesOverdue: ev[0]?.policies ?? 0,
  };
}

type Facts = Awaited<ReturnType<typeof gather>>;

/** What the committee is asked to decide, picked from the records. */
async function decisions(f: Facts): Promise<Decision[]> {
  const out: Decision[] = [];
  const APPETITE = 12;
  const sorted = [...f.risks].sort((a, b) => f.after(b) - f.after(a) || f.before(b) - f.before(a));
  for (const r of sorted) {
    const score = f.after(r);
    if (score < APPETITE) break;
    const accepting = r.treatment === "Accept" || r.status === "Accepted";
    if (accepting && r.accepted_by) continue;
    out.push(accepting
      ? {
          kind: "Risk acceptance", riskSeq: r.seq, title: r.title,
          why: `Risk #${r.seq} is to be accepted at a score of ${score}, above the level of ${APPETITE} at which acceptance needs this committee. Nobody has signed it off yet.`,
          recommend: `Accept it formally, with a review date and an owner, or fund treatment to bring it below ${APPETITE}.`,
        }
      : {
          kind: score >= 20 ? "Critical risk" : "Risk above appetite", riskSeq: r.seq, title: r.title,
          why: `Risk #${r.seq} still scores ${score} after the treatment planned for it, above the level of ${APPETITE}. ${r.owner.trim() ? `${r.owner.trim()} owns it.` : "Nobody owns it yet."}`,
          recommend: `Agree further treatment and the money for it, or accept the risk formally for a set period.`,
        });
  }
  const { rows: late } = await query<{ seq: number; title: string; type: string; due_date: string; owner: string }>(
    `select seq, title, type, due_date, owner from findings
      where status <> 'Closed' and due_date is not null and due_date < $1
      order by case when type like 'Major%' then 0 else 1 end, due_date limit 3`,
    [today()],
  );
  for (const g of late) {
    out.push({
      kind: "Overdue finding", title: g.title,
      why: `${g.type || "Finding"} F-${g.seq} was due on ${shortDate(g.due_date)} and is ${plural(daysBetween(g.due_date, today()), "day")} late. ${g.owner.trim() ? `${g.owner.trim()} owns it.` : "Nobody owns it."}`,
      recommend: "Agree a new date, and the people or budget needed to meet it.",
    });
  }
  return out;
}

// ── drawing helpers ──────────────────────────────────────────────────────────

const spaced = (text: string, size = 7, color = MUTED): Content =>
  ({ text: safe(text.toUpperCase()), fontSize: size, color, bold: true, characterSpacing: 1.1 });

const svgW = (svg: string, width: number, height: number, margin?: M): Content =>
  ({ svg, width, height, ...(margin ? { margin } : {}) }) as unknown as Content;

/** A small ▲ or ▼, drawn: the PDF standard fonts have no such glyph. */
const triangle = (dir: "up" | "down", color: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="6" height="6" viewBox="0 0 6 6"><path d="${dir === "up" ? "M3 0 L6 6 L0 6 Z" : "M0 0 L6 0 L3 6 Z"}" fill="${color}"/></svg>`;

/** "▲ 12" in a soft pill. */
function chip(text: string, tone: Tone, dir?: "up" | "down"): Content {
  const c = TONE[tone];
  return {
    table: { body: [[{
      columns: [
        ...(dir ? [svgW(triangle(dir, c.fg), 5, 5, [0, 1.6, 3, 0])] : []),
        { text: safe(text), fontSize: 7, bold: true, color: c.fg, width: "auto" },
      ],
      columnGap: 0, fillColor: c.bg, margin: [2, 0.5, 2, 0.5] as M,
    }]] },
    layout: "noBorders",
  } as unknown as Content;
}

/** A six-point trend line. */
function sparkline(values: number[], color: string): Content {
  if (values.length < 2) return { text: "", width: 58 } as unknown as Content;
  const w = 58, h = 18, lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => [1 + (i * (w - 4)) / (values.length - 1), h - 2 - ((v - lo) / span) * (h - 5)] as const);
  const last = pts[pts.length - 1]!;
  return svgW(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<polyline fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" points="${pts.map((p) => p.join(",")).join(" ")}"/>` +
      `<circle cx="${last[0]}" cy="${last[1]}" r="2" fill="${color}"/></svg>`,
    w, h,
  );
}

function section(no: string, title: string, hint = ""): Content {
  // The rule runs from the title to the hint. Its length is worked out from the
  // text, because a fixed-length line in a "*" column pushes the title onto
  // several lines instead of shrinking.
  const titleW = title.length * 6.9 + 4;
  const hintW = hint ? hint.length * 3.7 + 10 : 0;
  const line = Math.max(20, WIDTH - 22 - titleW - hintW - 12);
  return {
    columns: [
      { text: no, font: SERIF, bold: true, fontSize: 11, color: GOLD, width: 22, margin: [0, 2, 0, 0] },
      { text: safe(title), font: SERIF, bold: true, fontSize: 14, color: NAVY, width: titleW },
      { canvas: [{ type: "line", x1: 6, y1: 9, x2: line, y2: 9, lineWidth: 0.6, lineColor: LINE }], width: line + 6 },
      ...(hint ? [{ text: safe(hint), fontSize: 7.5, color: MUTED, width: "*", alignment: "right", margin: [0, 4, 0, 0] as M }] : []),
    ],
    columnGap: 0,
    margin: [0, 14, 0, 7],
  } as unknown as Content;
}

/** The headline as a half dial, with last paper's figure marked in gold. */
function gauge(pct: number, prev: number | null): Content {
  const cx = 110, cy = 112, r = 88;
  const at = (p: number): [number, number] => {
    const a = Math.PI * (1 - Math.max(0, Math.min(100, p)) / 100);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const [ex, ey] = at(pct);
  const tick = prev === null ? "" : (() => {
    const a = Math.PI * (1 - prev / 100);
    const [x1, y1] = [cx + (r - 13) * Math.cos(a), cy - (r - 13) * Math.sin(a)];
    const [x2, y2] = [cx + (r + 13) * Math.cos(a), cy - (r + 13) * Math.sin(a)];
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${GOLD}" stroke-width="3"/>`;
  })();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="122" viewBox="0 0 220 122">` +
    `<path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="#eceff4" stroke-width="16" stroke-linecap="round"/>` +
    (pct > 0 ? `<path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${ex} ${ey}" fill="none" stroke="${NAVY2}" stroke-width="16" stroke-linecap="round"/>` : "") +
    tick + `</svg>`;
  return {
    stack: [
      svgW(svg, 165, 92),
      { text: [{ text: String(pct), fontSize: 34 }, { text: "%", fontSize: 16, color: MUTED }], font: SERIF, bold: true, color: NAVY, alignment: "center", margin: [0, -50, 0, 0] },
    ],
    width: 170,
  } as unknown as Content;
}

/** Ten segments, filled to the share. */
function ladder(pct: number): Content {
  const seg = 10, w = 200, gap = 2.4, sw = (w - gap * (seg - 1)) / seg;
  let rects = "";
  for (let i = 0; i < seg; i++) {
    const fill = Math.max(0, Math.min(1, pct / 10 - i));
    const px = i * (sw + gap);
    rects += `<rect x="${px}" y="0" width="${sw}" height="9" rx="1.5" fill="#eceff4"/>`;
    if (fill > 0) rects += `<rect x="${px}" y="0" width="${sw * fill}" height="9" rx="1.5" fill="${NAVY2}"/>`;
  }
  return svgW(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="9" viewBox="0 0 ${w} 9">${rects}</svg>`, w, 9, [0, 4, 0, 0]);
}

/** Levels 1 to 5 as dots, filled to the level, the target ringed in gold. */
function dots(level: number, target: number): Content {
  let s = "";
  const filled = Math.round(level);
  for (let i = 1; i <= 5; i++) {
    const cxp = 4 + (i - 1) * 9;
    s += `<circle cx="${cxp}" cy="4.5" r="3.1" fill="${i <= filled ? NAVY2 : "#e3e7ee"}"/>`;
    if (i === target) s += `<circle cx="${cxp}" cy="4.5" r="3.7" fill="none" stroke="${GOLD}" stroke-width="1.3"/>`;
  }
  return svgW(`<svg xmlns="http://www.w3.org/2000/svg" width="46" height="9" viewBox="0 0 46 9">${s}</svg>`, 46, 9, [0, 2, 0, 0]);
}

const scoreTone = (s: number): { fg: string; bg: string } => (s >= 20 ? TONE.down : s >= 12 ? TONE.warn : TONE.up);
const scoreBox = (s: number): Content => {
  const t = scoreTone(s);
  return { table: { widths: [18], body: [[{ text: String(s), bold: true, fontSize: 8, color: t.fg, fillColor: t.bg, alignment: "center", margin: [0, 1.5, 0, 1.5] }]] }, layout: "noBorders", width: 20 } as unknown as Content;
};
const arrow = (w = 14, color = MUTED): Content =>
  svgW(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="6" viewBox="0 0 ${w} 6"><path d="M0 3 H${w - 3}" stroke="${color}" stroke-width="1"/><path d="M${w - 4} 0.5 L${w} 3 L${w - 4} 5.5 Z" fill="${color}"/></svg>`, w, 6, [3, 5, 3, 0]);

function avatar(name: string): Content {
  return svgW(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="${NAVY2}"/>` +
      `<text x="8" y="10.6" text-anchor="middle" font-family="Helvetica" font-weight="bold" font-size="6.6" fill="#ffffff">${x(initials(name))}</text></svg>`,
    16, 16, [0, -1, 5, 0],
  );
}

const HEAT = ["#eaf3ee", "#f6efd9", "#f3dcbf", "#e8b3a3", "#d98a85"];
function heatGrid(grid: number[][], label: string): Content {
  const band = (l: number, i: number): number => Math.min(4, Math.floor(((l + 1) * (i + 1) - 1) / 5));
  const rows: Content[][] = [];
  for (let l = 4; l >= 0; l--) {
    rows.push([0, 1, 2, 3, 4].map((i) => {
      const n = grid[l]![i]!;
      const b = band(l, i);
      return { text: n ? String(n) : " ", bold: true, fontSize: 8.5, color: b === 4 ? "#ffffff" : INK, fillColor: HEAT[b], alignment: "center", margin: [0, 3.2, 0, 3.2] } as unknown as Content;
    }));
  }
  return {
    stack: [
      { ...(spaced(label, 7) as object), margin: [0, 0, 0, 4] } as unknown as Content,
      { table: { widths: ["*", "*", "*", "*", "*"], body: rows }, layout: { hLineWidth: () => 1.5, vLineWidth: () => 1.5, hLineColor: () => "#ffffff", vLineColor: () => "#ffffff" } },
    ],
  } as unknown as Content;
}

// ── the document ─────────────────────────────────────────────────────────────

type Meta = { disclaimer: string; contact: string; edition: string };

/** Pages in a PDF from pdfkit, which writes its page objects uncompressed. */
const pageCount = (pdf: Buffer): number => (pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;

/**
 * The paper as a PDF, on two pages whatever is in it.
 *
 * A board paper that runs to a third page because one month had an extra
 * decision in it reads as careless. So it is laid out, measured, and laid out
 * again more tightly when it overflows: first the lists get shorter, then only
 * the first decision gets a card and the rest are named under it.
 */
export async function boardPdf(generatedBy: string, meta: Meta): Promise<Buffer> {
  let built = await boardDocument(generatedBy, meta, 0);
  let pdf = await renderPdf(built.doc);
  for (let level = 1; level <= 3 && pageCount(pdf) > 2; level++) {
    built = await boardDocument(generatedBy, meta, level);
    pdf = await renderPdf(built.doc);
  }
  await built.save();
  return pdf;
}

async function boardDocument(generatedBy: string, meta: Meta, tight: number): Promise<{ doc: TDocumentDefinitions; save: () => Promise<void> }> {
  const [f, snapshots, branding, organisation] = await Promise.all([gather(), loadSnapshots(), loadBranding(), loadOrganisation()]);
  const d = today();
  const prev = [...snapshots].reverse().find((s) => daysBetween(s.day, d) >= 7) ?? null;
  const asks = await decisions(f);

  const critical = f.risks.filter((r) => f.after(r) >= 20).length;
  const overdue = f.overdueTasks + f.overdueFindings;
  const now: Snapshot = { day: d, headline: f.headline, average: f.average, critical, overdue, atTarget: f.good, evidence: f.evidence };
  const series = (pick: (s: Snapshot) => number | null): number[] =>
    [...snapshots.filter((s) => s.day !== d).slice(-5), now].map(pick).filter((v): v is number => v !== null);
  // The headline has a daily history of its own: the last reading of each of the past six months.
  const { rows: trend } = await query<{ day: string; pct: number }>(
    "select day, pct from trend where day >= $1 order by day", [addDays(-185)],
  );
  const monthly = new Map<string, number>();
  for (const t of trend) monthly.set(t.day.slice(0, 7), t.pct);
  monthly.set(d.slice(0, 7), f.headline);
  const headSeries = [...monthly.values()].slice(-6);
  const prevHeadline = prev?.headline ?? null;

  // The verdict.
  const delta = prevHeadline === null ? null : f.headline - prevHeadline;
  const status: { word: string; tone: Tone } = delta === null ? { word: "First report", tone: "flat" }
    : delta >= 2 ? { word: "Improving", tone: "up" } : delta <= -2 ? { word: "Slipping", tone: "down" } : { word: "Steady", tone: "flat" };
  const weakest = [...f.areas].filter((a) => a.level < a.target).sort((a, b) => (a.level - a.target) - (b.level - b.target)).slice(0, 2);
  const weakThemes = [...f.themes].sort((a, b) => a.pct - b.pct).slice(0, 2);
  const verdict: Content[] = [];
  const em = (t: string): Content => ({ text: safe(t), bold: true, color: NAVY });
  if (f.scored) {
    verdict.push("We meet our target in ", em(`${f.headline}% of the framework`));
    verdict.push(f.assessed < f.counted.length ? ` (${f.good} of the ${f.assessed} controls assessed so far)` : "");
  } else {
    verdict.push(em(`${f.headline}% of the controls in scope`), " are in place");
  }
  verdict.push(delta === null ? ". " : delta === 0 ? `, the same as on ${shortDate(prev!.day)}. ` : `, ${delta > 0 ? "up" : "down"} from ${prevHeadline}% on ${shortDate(prev!.day)}. `);
  if (f.scored && weakest.length) {
    verdict.push(`Furthest from target: ${weakest.map((a) => a.name.toLowerCase()).join(" and ")}. `);
  } else if (!f.scored && weakThemes.length && weakThemes[0]!.pct < 100) {
    verdict.push(`Least far along: ${weakThemes[0]!.name.replace(/^A\.\d+\s*/, "").toLowerCase()} controls. `);
  }
  if (!f.scored && f.pack.features?.["certificationTracking"]) {
    const { rows: p } = await query<{ expires: string | null; body: string | null }>(
      "select json_extract(attrs, '$.certification.expires') as expires, json_extract(attrs, '$.certification.body') as body from programme where id = 1",
    );
    if (p[0]?.expires) verdict.push(`The certificate${p[0].body ? ` from ${p[0].body}` : ""} runs until ${longDate(p[0].expires)}. `);
  }
  verdict.push(asks.length ? em(`${asks.length === 1 ? "One decision is" : `${asks.length} decisions are`} needed`) : "No decision is needed", asks.length ? " from this committee." : " from this committee this time.");

  const logo = boardLogo(branding.logo ? { kind: branding.logo.kind, data: branding.logo.data } : null);
  const orgName = organisation.name.trim();

  // ── page 1: the band ──
  const band: Content = {
    stack: [
      {
        columns: [
          { ...(spaced(`${product.name}  ·  ${product.framework}`, 7, BAND_TEXT) as object), width: "*", margin: [0, 6, 0, 0] } as unknown as Content,
          logo
            ? { table: { body: [[{ ...(logo as object), fillColor: "#ffffff", margin: [6, 4, 6, 4] } as unknown as Content]] }, layout: "noBorders", width: "auto" } as unknown as Content
            : { text: "", width: "auto" },
        ],
      },
      { text: "Executive summary", font: SERIF, bold: true, fontSize: 30, color: "#ffffff", margin: [0, 14, 0, 2] },
      { text: safe(f.scored ? `Our cyber security position against the ${product.framework}` : `Our information security position against ${product.framework}`), fontSize: 10, color: BAND_TEXT },
      {
        columns: [
          ...(orgName ? [{ stack: [spaced("Organisation", 6.5, BAND_MUTED), { text: safe(orgName), fontSize: 9.5, color: "#ffffff", margin: [0, 2, 0, 0] as M }], width: "auto" }] : []),
          { stack: [spaced("As at", 6.5, BAND_MUTED), { text: longDate(d), fontSize: 9.5, color: "#ffffff", margin: [0, 2, 0, 0] as M }], width: "auto" },
          { stack: [spaced("Compared with", 6.5, BAND_MUTED), { text: prev ? longDate(prev.day) : "No earlier paper", fontSize: 9.5, color: "#ffffff", margin: [0, 2, 0, 0] as M }], width: "auto" },
          { stack: [spaced("Prepared by", 6.5, BAND_MUTED), { text: safe(generatedBy), fontSize: 9.5, color: "#ffffff", margin: [0, 2, 0, 0] as M }], width: "auto" },
        ],
        columnGap: 26,
        margin: [0, 18, 0, 0],
      },
    ],
    margin: [0, 0, 0, 0],
  } as unknown as Content;

  // ── hero ──
  const hero: Content = {
    columns: [
      { stack: [gauge(f.headline, prevHeadline), { ...(spaced(f.scored ? "of the framework at target" : "of controls in place", 6) as object), characterSpacing: 0.8, alignment: "center", margin: [0, 10, 0, 0] } as unknown as Content], width: 170 },
      {
        stack: [
          { table: { body: [[{ text: safe(status.word.toUpperCase()), fontSize: 7, bold: true, characterSpacing: 1.2, color: TONE[status.tone].fg, fillColor: TONE[status.tone].bg, margin: [6, 2, 6, 2] }]] }, layout: "noBorders" },
          { text: verdict.map((v) => (typeof v === "string" ? safe(v) : v)) as unknown as Content[], font: SERIF, fontSize: 12.5, lineHeight: 1.32, color: INK, margin: [0, 8, 0, 0] } as unknown as Content,
        ],
        width: "*",
        margin: [10, 10, 0, 0],
      },
    ],
    margin: [0, 34, 0, 0],
  } as unknown as Content;

  // ── key figures ──
  const change = (now: number | null, then: number | null | undefined, goodWhenUp: boolean, unit = ""): Content => {
    if (now === null || then === null || then === undefined) return { text: "", width: "auto" } as unknown as Content;
    const dlt = Math.round((now - then) * 10) / 10;
    if (dlt === 0) return chip("no change", "flat");
    const better = goodWhenUp ? dlt > 0 : dlt < 0;
    return chip(`${Math.abs(dlt)}${unit}`, better ? "up" : "down", dlt > 0 ? "up" : "down");
  };
  const kpi = (label: string, value: Content[], ch: Content, spark: Content, note: string): Content => ({
    stack: [
      spaced(label, 6.6),
      { text: value, font: SERIF, bold: true, fontSize: 21, color: NAVY, margin: [0, 4, 0, 1] },
      { columns: [{ ...(ch as object), width: "auto" } as unknown as Content, { text: "", width: "*" }, { ...(spark as object), width: 58 } as unknown as Content], margin: [0, 1, 0, 3] },
      { text: safe(note), fontSize: 7.3, color: INK2 },
    ],
    margin: [9, 9, 9, 9],
  } as unknown as Content);
  const small = (t: string): Content => ({ text: safe(t), font: "Helvetica", bold: false, fontSize: 8.5, color: MUTED });
  const kpis: Content = {
    table: {
      widths: ["*", "*", "*", "*"],
      body: [[
        f.scored
          ? kpi("At target", [String(f.good), small(` / ${f.assessed}`)], change(f.good, prev?.atTarget, true), sparkline(series((s) => s.atTarget), BLUE), "controls at their target level")
          : kpi("In place", [String(f.good), small(` / ${f.counted.length}`)], change(f.good, prev?.atTarget, true), sparkline(series((s) => s.atTarget), BLUE), "controls in scope implemented"),
        f.scored
          ? kpi("Average maturity", [f.average === null ? "-" : f.average.toFixed(1), small(" / 5")], change(f.average, prev?.average, true), sparkline(series((s) => s.average), BLUE),
              f.assessed < f.counted.length ? `${f.counted.length - f.assessed} not assessed yet` : `target level ${MATURITY_DEFAULT_TARGET} unless set higher`)
          : kpi("Evidence gaps", [String(f.bareControls)], { text: "", width: "auto" } as unknown as Content, { text: "", width: 58 } as unknown as Content, "in place, but nothing to prove it"),
        kpi("Critical risks", [String(critical), small(` of ${f.risks.length} open`)], change(critical, prev?.critical, false), sparkline(series((s) => s.critical), TONE.down.fg), "score 20 or more after treatment"),
        kpi("Overdue", [String(overdue)], change(overdue, prev?.overdue, false), sparkline(series((s) => s.overdue), TONE.up.fg), `${plural(f.overdueTasks, "task")}, ${plural(f.overdueFindings, "finding")}`),
      ]],
    },
    layout: {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0.7 : 0),
      vLineWidth: () => 0.7, hLineColor: () => LINE, vLineColor: () => LINE,
    },
    margin: [0, 16, 0, 0],
  } as unknown as Content;

  // ── decisions ──
  const card = (dec: Decision, i: number): Content => ({
    table: {
      widths: ["*"],
      body: [[{
        stack: [
          spaced(`Decision ${i + 1}  ·  ${dec.kind}`, 6.6, GOLD),
          { text: safe(dec.title), font: SERIF, bold: true, fontSize: 11, color: NAVY, margin: [0, 4, 0, 4] },
          { text: safe(dec.why), fontSize: 8, color: INK2, lineHeight: 1.3 },
          {
            table: { widths: ["*"], body: [[{ stack: [spaced("Recommendation", 6, GOLD_LIGHT), { text: safe(dec.recommend), fontSize: 8, color: "#ffffff", margin: [0, 2, 0, 0] }], fillColor: NAVY, margin: [7, 6, 7, 6] }]] },
            layout: "noBorders", margin: [0, 8, 0, 0],
          },
        ],
        margin: [9, 9, 9, 9],
      }]],
    },
    layout: {
      hLineWidth: (k: number) => (k === 0 ? 2.5 : 0.7), vLineWidth: () => 0.7,
      hLineColor: (k: number) => (k === 0 ? GOLD : LINE), vLineColor: () => LINE,
    },
  } as unknown as Content);
  const shown = asks.slice(0, tight >= 2 ? 1 : 2);
  const decisionBlock: Content = shown.length
    ? {
        stack: [
          { columns: shown.map((dec, i) => ({ ...(card(dec, i) as object), width: "*" } as unknown as Content)), columnGap: 12 },
          ...(asks.length > shown.length ? [{ text: safe(`Also for the committee: ${asks.slice(shown.length).map((a) => `${a.title} (${a.kind.toLowerCase()})`).join("; ")}.`), fontSize: 7.5, color: INK2, margin: [0, 6, 0, 0] as M }] : []),
        ],
      } as unknown as Content
    : { table: { widths: ["*"], body: [[{ text: "Nothing needs the committee's decision this time: no risk is above appetite without a decision, and no finding is overdue.", fontSize: 9, color: TONE.up.fg, fillColor: TONE.up.bg, margin: [10, 8, 10, 8] }]] }, layout: "noBorders" } as unknown as Content;

  // ── domains ──
  const domains: Content = {
    stack: f.themes.map((t) => ({
      columns: [
        { stack: [{ text: safe(t.name), bold: true, fontSize: 8.8, color: INK }, { text: safe(f.scored && t.den < t.count ? `${t.count} controls, ${t.den} assessed` : plural(t.count, "control")), fontSize: 7.2, color: MUTED }], width: 170 },
        { ...(ladder(t.pct) as object), width: 200 } as unknown as Content,
        { text: [{ text: `${t.pct}%`, font: SERIF, bold: true, fontSize: 12, color: NAVY }, { text: `  ${t.num} of ${t.den}`, fontSize: 7.8, color: INK2 }], alignment: "right", width: "*", margin: [0, 1, 0, 0] },
      ],
      columnGap: 10,
      margin: [0, 0, 0, 7],
    } as unknown as Content)),
  } as unknown as Content;

  // ── needs attention / strongest ──
  // pdfmake cannot lay out a table with no rows, so an empty list says so instead.
  const listTable = (rows: Content[][], widths: (string | number)[]): Content => !rows.length
    ? { text: "Nothing to show yet.", fontSize: 8.5, color: MUTED, margin: [0, 4, 0, 0] } as unknown as Content
    : ({
    table: { widths, body: rows },
    layout: { hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0 : 0.6), vLineWidth: () => 0, hLineColor: () => LINE, paddingTop: () => 4.5, paddingBottom: () => 4.5, paddingLeft: () => 0, paddingRight: () => 4 },
  } as unknown as Content);
  let attention: Content;
  let strongest: Content;
  if (f.scored && f.areas.length) {
    const below = [...f.areas].sort((a, b) => (a.level - a.target) - (b.level - b.target)).slice(0, tight >= 1 ? 2 : 3);
    const best = [...f.areas].sort((a, b) => (b.level - b.target) - (a.level - a.target) || b.level - a.level).slice(0, tight >= 1 ? 2 : 3);
    const row = (a: Area): Content[] => [
      { text: a.ref, font: "Courier", fontSize: 7.5, color: MUTED },
      { text: safe(a.name), fontSize: 8.5, color: INK },
      dots(a.level, a.target),
      { text: `${a.level.toFixed(1)}/${a.target}`, fontSize: 7, color: MUTED, alignment: "right", margin: [0, 1, 0, 0] },
    ];
    attention = listTable(below.map(row), [34, "*", 46, 24]);
    strongest = { stack: [listTable(best.map(row), [34, "*", 46, 24]), { text: "Dots show levels 1 to 5, the average of each area; the gold ring is its target.", fontSize: 6.8, color: MUTED, margin: [0, 4, 0, 0] }] } as unknown as Content;
  } else {
    const items = [
      { n: f.bareControls, t: "controls in place with no evidence to prove it" },
      { n: f.staleEvidence, t: "evidence items older than 90 days or undated" },
      { n: f.notStarted, t: "controls in scope not started yet" },
      { n: f.policiesOverdue, t: "policies past their review date" },
      { n: f.overdueFindings, t: "findings past their due date" },
    ].filter((i) => i.n > 0).sort((a, b) => b.n - a.n).slice(0, tight >= 1 ? 2 : 3);
    attention = items.length
      ? listTable(items.map((i) => [{ text: String(i.n), font: SERIF, bold: true, fontSize: 11, color: TONE.down.fg }, { text: safe(i.t), fontSize: 8.5, color: INK, margin: [0, 2, 0, 0] }]), [30, "*"])
      : { text: "Nothing stands out.", fontSize: 8.5, color: MUTED };
    strongest = listTable(
      [...f.themes].sort((a, b) => b.pct - a.pct).slice(0, tight >= 1 ? 2 : 3).map((t) => [
        { text: `${t.pct}%`, font: SERIF, bold: true, fontSize: 11, color: TONE.up.fg },
        { text: safe(t.name), fontSize: 8.5, color: INK, margin: [0, 2, 0, 0] },
      ]),
      [30, "*"],
    );
  }
  const split: Content = {
    columns: [
      { stack: [{ text: "Needs attention", font: SERIF, bold: true, fontSize: 11, color: NAVY, margin: [0, 0, 0, 3] }, attention], width: "*" },
      { stack: [{ text: "Strongest", font: SERIF, bold: true, fontSize: 11, color: NAVY, margin: [0, 0, 0, 3] }, strongest], width: "*" },
    ],
    columnGap: 20,
    margin: [0, 10, 0, 0],
  } as unknown as Content;

  // ── page 2: risks ──
  const decided = new Set(asks.map((a) => a.riskSeq).filter((s): s is number => s !== undefined));
  const top = [...f.risks].sort((a, b) => f.after(b) - f.after(a) || f.before(b) - f.before(a)).slice(0, tight >= 3 ? 4 : 5);
  const riskRows: Content[][] = top.map((r) => {
    const mine = f.links.filter((l) => l.risk_id === r.id);
    const done = mine.filter((l) => l.status === "implemented").length;
    const next = decided.has(r.seq) ? ["Committee decision", "this meeting"]
      : mine.length && done < mine.length ? [`Put ${plural(mine.length - done, "control")} in place`, r.review_date ? `review ${shortDate(r.review_date)}` : "no date set"]
      : !mine.length && r.treatment !== "Accept" ? ["Choose its controls", "not treated yet"]
      : [r.review_date ? "Review" : "Keep under review", r.review_date ? shortDate(r.review_date) : "no date set"];
    const detail = decided.has(r.seq) ? `#${r.seq} · see the decisions on page 1`
      : mine.length ? `#${r.seq} · ${done} of ${mine.length} controls in place` : `#${r.seq} · ${r.treatment.toLowerCase()}`;
    return [
      { stack: [{ text: safe(r.title), bold: true, fontSize: 8.6, color: INK }, { text: safe(detail), fontSize: 7.3, color: MUTED, margin: [0, 1, 0, 0] }] },
      r.owner.trim() ? { columns: [{ ...(avatar(r.owner) as object), width: 21 } as unknown as Content, { text: safe(r.owner.trim()), fontSize: 8, color: INK2, margin: [0, 2, 0, 0] }] } : { text: "Nobody", fontSize: 8, color: TONE.down.fg },
      { columns: [scoreBox(f.before(r)), { ...(arrow() as object), width: 20 } as unknown as Content, scoreBox(f.after(r))], columnGap: 0 },
      { stack: [{ text: safe(next[0]!), bold: true, fontSize: 8, color: INK }, { text: safe(next[1]!), fontSize: 7.3, color: MUTED }] },
    ];
  });
  const th = (t: string): Content => ({ ...(spaced(t, 6.5) as object), margin: [0, 0, 0, 3] } as unknown as Content);
  const risksTable: Content = riskRows.length
    ? {
        table: { headerRows: 1, dontBreakRows: true, widths: ["*", 104, 76, 96], body: [[th("Risk"), th("Owner"), th("Before / after"), th("Next step")], ...riskRows] },
        layout: { hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 1 ? 1 : i === 0 || i === node.table.body.length ? 0 : 0.6), vLineWidth: () => 0, hLineColor: (i: number) => (i === 1 ? NAVY : LINE), paddingTop: () => 5, paddingBottom: () => 5, paddingLeft: () => 3, paddingRight: () => 3 },
      } as unknown as Content
    : { text: "No open risks are recorded.", fontSize: 9, color: MUTED };

  // ── heat maps ──
  const grid = (pick: (r: RiskRow) => [number, number]): number[][] => {
    const g = [0, 1, 2, 3, 4].map(() => [0, 0, 0, 0, 0]);
    for (const r of f.risks) {
      const [l, i] = pick(r);
      if (l >= 1 && l <= 5 && i >= 1 && i <= 5) g[l - 1]![i - 1]!++;
    }
    return g;
  };
  const criticalBefore = f.risks.filter((r) => f.before(r) >= 20).length;
  const heat: Content = {
    stack: [
      {
        columns: [
          { ...(heatGrid(grid((r) => [r.likelihood, r.impact]), "Before treatment") as object), width: "*" } as unknown as Content,
          { stack: [svgW(`<svg xmlns="http://www.w3.org/2000/svg" width="34" height="12" viewBox="0 0 34 12"><path d="M0 6 H28" stroke="${GOLD}" stroke-width="1.6"/><path d="M26 1 L34 6 L26 11 Z" fill="${GOLD}"/></svg>`, 34, 12, [6, 44, 0, 4]), { ...(spaced("treatment", 5.8) as object), alignment: "center" } as unknown as Content], width: 46 },
          { ...(heatGrid(grid((r) => [r.res_likelihood ?? r.likelihood, r.res_impact ?? r.impact]), "After treatment") as object), width: "*" } as unknown as Content,
        ],
        columnGap: 8,
      },
      { text: safe(`Impact runs left to right, likelihood bottom to top. ${plural(criticalBefore, "risk")} ${criticalBefore === 1 ? "is" : "are"} critical before treatment; ${critical} ${critical === 1 ? "stays" : "stay"} critical after it.`), fontSize: 7.3, color: MUTED, margin: [0, 5, 0, 0] },
    ],
  } as unknown as Content;

  // ── the next 90 days ──
  const horizon = addDays(90);
  const { rows: upcoming } = await query<{ due: string; what: string }>(
    `select due_date as due, title as what from tasks where status <> 'Done' and due_date is not null and due_date <= $1
     union all select due_date, 'Finding: ' || title from findings where status <> 'Closed' and due_date is not null and due_date <= $1
     union all select planned_date, title from reviews where status = 'Planned' and planned_date is not null and planned_date between $2 and $1
     union all select review_date, 'Review the ' || lower(name) from policies where review_date is not null and review_date <= $1
     order by 1 limit 6`,
    [horizon, d],
  );
  const timeline: Content = upcoming.length
    ? (() => {
        const n = upcoming.length;
        const colW = WIDTH / n;
        const lateCount = upcoming.filter((u) => u.due < d).length;
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="12" viewBox="0 0 ${WIDTH} 12">`;
        svg += `<path d="M0 6 H${WIDTH}" stroke="${LINE}" stroke-width="2"/>`;
        if (lateCount) svg += `<path d="M0 6 H${colW * lateCount}" stroke="${TONE.down.fg}" stroke-width="2"/>`;
        upcoming.forEach((u, i) => {
          const late = u.due < d;
          svg += `<circle cx="${i * colW + 5}" cy="6" r="4" fill="${late ? TONE.down.fg : "#ffffff"}" stroke="${late ? TONE.down.fg : NAVY2}" stroke-width="2"/>`;
        });
        svg += "</svg>";
        return {
          stack: [
            svgW(svg, WIDTH, 12),
            {
              columns: upcoming.map((u) => {
                const late = u.due < d;
                const lateBy = daysBetween(u.due, d);
                return {
                  stack: [
                    spaced(late ? `${plural(lateBy, "day")} late` : shortDate(u.due), 6.6, late ? TONE.down.fg : NAVY),
                    { text: safe(u.what), fontSize: 7.8, color: INK2, margin: [0, 2, 6, 0] as M },
                  ],
                  width: colW,
                };
              }),
              columnGap: 0,
              margin: [0, 6, 0, 0],
            },
          ],
        } as unknown as Content;
      })()
    : { text: "Nothing is due in the next 90 days.", fontSize: 8.5, color: MUTED };

  // ── since last time ──
  let tiles: { big: string; text: string }[];
  if (prev) {
    const { rows: s } = await query<{ closed: number; risks: number; crit: number }>(
      `select (select count(*) from findings where status = 'Closed' and updated_at >= $1) as closed,
              (select count(*) from risks where created_at >= $1) as risks,
              (select count(*) from risks where created_at >= $1 and status <> 'Closed'
                 and coalesce(res_likelihood, likelihood) * coalesce(res_impact, impact) >= 20) as crit`,
      [prev.day],
    );
    const moved = f.good - prev.atTarget;
    tiles = [
      { big: `${moved > 0 ? "+" : ""}${moved}`, text: f.scored ? "controls at their target level" : "controls in place" },
      { big: String(s[0]?.closed ?? 0), text: "findings closed" },
      { big: String(s[0]?.risks ?? 0), text: `new risks recorded${(s[0]?.crit ?? 0) ? `, ${s[0]!.crit} of them critical` : ""}` },
      { big: String(f.evidence), text: `evidence items; ${f.staleEvidence} older than 90 days or undated` },
    ];
  } else {
    tiles = [
      { big: String(f.good), text: f.scored ? "controls at their target level" : "controls in place" },
      { big: String(f.risks.length), text: "open risks" },
      { big: String(overdue), text: "overdue tasks and findings" },
      { big: String(f.evidence), text: `evidence items; ${f.staleEvidence} older than 90 days or undated` },
    ];
  }
  const since: Content = {
    columns: tiles.map((t) => ({
      table: { widths: ["*"], body: [[{ stack: [{ text: safe(t.big), font: SERIF, bold: true, fontSize: 15, color: NAVY }, { text: safe(t.text), fontSize: 7.6, color: INK2, margin: [0, 2, 0, 0] }], fillColor: SOFT, margin: [8, 7, 8, 7] }]] },
      layout: "noBorders",
      width: "*",
    } as unknown as Content)),
    columnGap: 8,
  } as unknown as Content;

  const method: Content = {
    table: { widths: ["*"], body: [[{
      text: safe(
        (f.scored
          ? `How the figures are worked out: each control is scored 0 to 5. The target is level ${MATURITY_DEFAULT_TARGET} unless a control carries a higher one. `
          : "How the figures are worked out: the share of controls in scope whose status is Implemented. ") +
          "Risk scores are likelihood times impact, before and after treatment; 20 or more is critical, and a risk above 12 needs this committee to accept it. " +
          (prev ? `Changes compare with the paper of ${longDate(prev.day)}.` : "This is the first paper, so there is nothing to compare with yet."),
      ),
      fontSize: 7.2, color: MUTED, lineHeight: 1.3, margin: [7, 2, 0, 2],
    }]] },
    layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 1.5 : 0), vLineColor: () => GOLD },
    margin: [0, 14, 0, 0],
  } as unknown as Content;

  const stampTime = new Date().toISOString().slice(11, 16);
  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [SIDE, 52, SIDE, 58],
    defaultStyle: { font: "Helvetica", fontSize: 9, color: INK, lineHeight: 1.2 },
    info: { title: "Executive summary", author: "Offset Security", subject: safe(`${product.name} - ${product.framework}`), creator: safe(product.name) },
    background: (page: number) => ({
      canvas: page === 1
        ? [
            { type: "rect", x: 0, y: 0, w: PAGE_W, h: BAND_H, color: NAVY },
            ...[44, 74, 104, 134, 164].map((r) => ({ type: "ellipse" as const, x: PAGE_W, y: 18, r1: r, r2: r, lineColor: "#2a3a5e", lineWidth: 0.6 })),
            { type: "rect", x: 0, y: BAND_H, w: PAGE_W * 0.55, h: 2.6, color: GOLD },
            { type: "rect", x: PAGE_W * 0.55, y: BAND_H, w: PAGE_W * 0.2, h: 2.6, color: GOLD_LIGHT },
          ]
        : [{ type: "rect", x: 0, y: 0, w: PAGE_W, h: 34, color: NAVY }],
    }) as unknown as Content,
    header: (page: number) => (page === 1 ? null : {
      columns: [
        { ...(spaced(`Executive summary  ·  ${longDate(d)}`, 6.8, BAND_TEXT) as object), width: "*", margin: [0, 3, 0, 0] } as unknown as Content,
        { text: safe(orgName || product.name), font: SERIF, bold: true, fontSize: 10.5, color: "#ffffff", width: "auto" },
      ],
      margin: [SIDE, 11, SIDE, 0],
    }) as unknown as Content,
    footer: (page: number, pages: number) => ({
      stack: [
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: WIDTH, y2: 0, lineWidth: 0.5, lineColor: LINE }], margin: [0, 0, 0, 5] },
        {
          columns: [
            { text: safe(`Board confidential  ·  built from live data on ${longDate(d)} at ${stampTime} UTC by ${generatedBy}  ·  recorded in the audit log`), fontSize: 6.8, color: MUTED, width: "*" },
            { text: `${page} / ${pages}`, font: SERIF, bold: true, fontSize: 9, color: NAVY, width: "auto" },
          ],
        },
        {
          text: safe(`© ${new Date().getFullYear()} Offset Security${meta.edition ? `  ·  ${meta.edition}` : ""}  ·  ${meta.disclaimer}  ·  ${meta.contact}`),
          fontSize: 6, color: "#a3acbb", margin: [0, 3, 0, 0],
        },
      ],
      margin: [SIDE, 12, SIDE, 0],
    }) as unknown as Content,
    content: [
      { ...(band as object), margin: [0, -20, 0, 0] } as unknown as Content,
      hero,
      kpis,
      section("01", "Decisions for the committee"),
      decisionBlock,
      section("02", "Where we stand, by domain", f.scored ? "share of assessed controls at target" : "share of controls in place"),
      domains,
      split,
      { ...(section("03", "The risks that matter most", "score: likelihood x impact") as object), pageBreak: "before", margin: [0, 4, 0, 8] } as unknown as Content,
      risksTable,
      { unbreakable: true, stack: [section("04", "Risk before and after treatment", plural(f.risks.length, "open risk")), heat] } as unknown as Content,
      { unbreakable: true, stack: [section("05", "The next 90 days"), timeline] } as unknown as Content,
      { unbreakable: true, stack: [section("06", prev ? "Since the last paper" : "Where things stand"), since] } as unknown as Content,
      ...(tight >= 3 ? [] : [method]),
    ],
  };
  return { doc, save: () => saveSnapshot(snapshots, now) };
}
