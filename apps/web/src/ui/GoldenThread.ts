import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { linkTo } from "./deepLink.js";
import {
  pack, risks as risksApi, evidence as evidenceApi, thread as api,
  type Evidence, type ThreadControl, type ThreadData, type ThreadEvidence, type ThreadRisk,
} from "../persistence/apiClient.js";
import { LinkPicker } from "./LinkPicker.js";
import { suggestControls } from "./suggest.js";
import { plural } from "./format.js";

/**
 * The golden thread: every risk, the controls that treat it, and the evidence
 * that those controls work, drawn as one map.
 *
 * It is the line an auditor follows. They pick a risk, ask what reduces it,
 * and ask to see that working. A break anywhere along it is where a finding
 * comes from, so the map makes breaks impossible to miss: broken links dashed
 * red, weak ones dashed amber, and a switch that hides everything that is fine.
 *
 * Every control is shown, not a sample. Risks and evidence sit beside the
 * controls they join, so most lines run straight across instead of tangling.
 *
 * Drawn as one SVG string and lit by toggling classes, not by re-rendering:
 * Anchor has 1,014 controls, and re-rendering that many nodes on every
 * mouse move would make the page crawl.
 */

export type Level = "bad" | "warn";
export interface Problem {
  level: Level;
  kind: "untreated" | "noproof" | "stale" | "undated" | "noowner";
  text: string;
}

/**
 * A clause of the standard that a risk's thread has to satisfy.
 *
 * Worked out from the records, never stored: there is nothing to keep in step,
 * and the colour is always what the data says today. Green satisfies it, amber
 * partly, red does not.
 */
export interface ClauseState {
  clause: string;
  name: string;
  level: "ok" | "warn" | "bad";
  text: string;
  /** What to do about it, and where to do it. Absent when the clause is met. */
  fix?: { how: string; goto?: string; label?: string };
}

/**
 * How the checks on a risk are labelled. ISO products name the clause each one
 * comes from; the other frameworks have no such clauses, so they get plain
 * names. `reasons` asks for a written reason on every chosen control, for the
 * products that keep a Statement of Applicability.
 */
export interface CheckStyle { iso: boolean; reasons: boolean }
const ISO_STYLE: CheckStyle = { iso: true, reasons: true };

/** What is wrong with each part of the thread, and the totals. Shared with Get ready. */
export function analyse(d: ThreadData, withClauses = false, style: CheckStyle = ISO_STYLE) {
  const evOf = new Map<string, ThreadEvidence[]>();
  for (const e of d.evidence) for (const c of e.controls) evOf.set(c, [...(evOf.get(c) ?? []), e]);
  const risksOf = new Map<string, ThreadRisk[]>();
  for (const r of d.risks) for (const c of r.controls) risksOf.set(c, [...(risksOf.get(c) ?? []), r]);

  const evidenceOld = (e: ThreadEvidence): boolean => e.ageDays === null || e.ageDays > d.staleDays;

  const control = (c: ThreadControl): Problem | null => {
    if (c.status !== "implemented") return null;
    const evidence = evOf.get(c.id) ?? [];
    if (!evidence.length) {
      return { level: "bad", kind: "noproof", text: "Marked as implemented, but no evidence is linked. Auditors look for these first." };
    }
    if (evidence.every(evidenceOld)) {
      const dated = evidence.filter((e) => e.ageDays !== null).map((e) => e.ageDays as number);
      return dated.length
        ? { level: "warn", kind: "stale", text: `Its newest evidence is ${Math.min(...dated)} days old. Over ${d.staleDays} days, evidence no longer shows the control working now.` }
        : { level: "warn", kind: "undated", text: "Its evidence has no collected date, so it cannot show the control working now." };
    }
    if (!c.owner.trim()) {
      return { level: "warn", kind: "noowner", text: "Nobody owns it. Expect \"who is responsible for this?\"" };
    }
    return null;
  };

  /** Risks being reduced or transferred need something doing it. Accepted, avoided and closed ones do not. */
  const risk = (r: ThreadRisk): Problem | null => {
    const needs = !["Closed", "Accepted"].includes(r.status) && (r.treatment === "Mitigate" || r.treatment === "Transfer");
    return needs && !r.controls.length
      ? { level: "bad", kind: "untreated", text: "Nothing treats this risk. Every risk you are reducing needs a control that reduces it." }
      : null;
  };

  const byId = new Map(d.controls.map((c) => [c.id, c] as const));

  /**
   * The three clauses a risk passes through: 6.1.2 (assess it), 6.1.3 (decide
   * the treatment and give the reasons in the Statement of Applicability) and
   * 8.3 (carry the treatment out). A risk that is accepted, avoided or closed
   * needs no control, so its treatment clauses are met by the decision itself.
   */
  // ISO names the clause; elsewhere a short word fits the same chip on the map.
  const [ASSESS, TREAT, DONE] = style.iso ? ["6.1.2", "6.1.3", "8.3"] : ["Owner", "Chosen", "In place"];
  const clauses = (r: ThreadRisk): ClauseState[] => {
    const decided = ["Closed", "Accepted"].includes(r.status) || r.treatment === "Accept" || r.treatment === "Avoid";
    const cs = r.controls.map((id) => byId.get(id)).filter((c): c is ThreadControl => c !== undefined);
    const out: ClauseState[] = [];

    out.push(r.owner.trim()
      ? { clause: ASSESS, name: "Risk assessment", level: "ok", text: `Scored, and owned by ${r.owner.trim()}.` }
      : { clause: ASSESS, name: "Risk assessment", level: "warn", text: "Scored, but nobody owns it. Someone with authority has to be able to decide about it.",
          fix: { how: "Open the risk and fill in Owner.", goto: linkTo("risks", r.id, "owner"), label: "Name an owner" } });

    if (decided) {
      out.push({ clause: TREAT, name: "Risk treatment", level: "ok", text: `Decided: ${r.status === "Accepted" || r.treatment === "Accept" ? "accepted" : r.status === "Closed" ? "closed" : "avoided"}. No control is needed.` });
      out.push({ clause: DONE, name: "Treatment carried out", level: "ok", text: "Nothing to carry out." });
      return out;
    }
    if (!cs.length) {
      out.push({ clause: TREAT, name: "Risk treatment", level: "bad", text: style.reasons ? "No control is chosen to treat it, so there is no treatment to justify." : "No control is chosen to treat it.",
                 fix: { how: "Choose the controls that treat it, with the button below." } });
      out.push({ clause: DONE, name: "Treatment carried out", level: "bad", text: "Nothing is being done about it.",
                 fix: { how: "Choose the controls first. Then put each one in place." } });
      return out;
    }
    const unreasoned = style.reasons ? cs.filter((c) => !c.justified) : [];
    out.push(unreasoned.length === 0
      ? { clause: TREAT, name: "Risk treatment", level: "ok", text: style.reasons
          ? `All ${cs.length} ${cs.length === 1 ? "control has" : "controls have"} a reason in the Statement of Applicability.`
          : `${cs.length} ${cs.length === 1 ? "control is" : "controls are"} chosen to treat it: ${cs.map((c) => c.ref).join(", ")}.` }
      : { clause: TREAT, name: "Risk treatment", level: "warn", text: `${unreasoned.length} of ${cs.length} have no reason in the Statement of Applicability: ${unreasoned.map((c) => c.ref).join(", ")}.`,
          fix: { how: `Write a reason for ${unreasoned.map((c) => c.ref).join(", ")}: say why it is included.`,
                 goto: linkTo("controls", unreasoned[0]!.id, "justification"), label: `Write the reason for ${unreasoned[0]!.ref}` } });
    const done = cs.filter((c) => c.status === "implemented").length;
    const todo = cs.filter((c) => c.status !== "implemented").map((c) => c.ref).join(", ");
    const next = cs.find((c) => c.status !== "implemented");
    const doIt = { how: `Put ${todo} in place. When each is done, set it to Implemented and link its evidence.`,
                   goto: next ? linkTo("controls", next.id, "status") : "#/controls", label: next ? `Open ${next.ref}` : "Open Controls" };
    out.push(done === cs.length
      ? { clause: DONE, name: "Treatment carried out", level: "ok", text: `All ${cs.length} ${cs.length === 1 ? "control is" : "controls are"} in place.` }
      : done > 0 || cs.some((c) => c.status === "in_progress")
        ? { clause: DONE, name: "Treatment carried out", level: "warn", text: `${done} of ${cs.length} controls are in place. The rest are under way or not started.`, fix: doIt }
        : { clause: DONE, name: "Treatment carried out", level: "bad", text: `None of its ${cs.length} ${cs.length === 1 ? "control is" : "controls are"} in place yet.`, fix: doIt });
    return out;
  };
  const cl = new Map(d.risks.map((r) => [r.id, withClauses ? clauses(r) : []] as const));

  const cp = new Map(d.controls.map((c) => [c.id, control(c)] as const));
  const rp = new Map(d.risks.map((r) => [r.id, risk(r)] as const));
  const all = [...cp.values(), ...rp.values()].filter((p): p is Problem => p !== null);
  return {
    evOf, risksOf, evidenceOld, controlProblem: cp, riskProblem: rp, clausesOf: cl,
    clauseGaps: [...cl.values()].filter((l) => l.some((c) => c.level !== "ok")).length,
    whole: d.controls.filter((c) => c.status === "implemented" && !cp.get(c.id)).length,
    broken: all.filter((p) => p.level === "bad").length,
    weak: all.filter((p) => p.level === "warn").length,
    unlinked: d.controls.filter((c) => c.status !== "not_applicable" && !risksOf.has(c.id)).length,
  };
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Spreads items down a column near where they want to be, without overlapping. */
function place(desired: number[], step: number, top: number, bottom: number): number[] {
  const order = desired.map((_, i) => i).sort((a, b) => desired[a]! - desired[b]!);
  const y = new Array<number>(desired.length);
  let cur = top;
  for (const i of order) { cur = Math.max(cur, desired[i]!); y[i] = cur; cur += step; }
  let lim = bottom - step;
  for (const i of [...order].reverse()) { if (y[i]! > lim) y[i] = lim; lim = y[i]! - step; }
  return y;
}

const STATUS_WORD: Record<string, string> = {
  in_progress: "in progress", not_started: "not started", not_applicable: "not applicable",
};

type Sel = { type: "r" | "c" | "e"; id: string } | null;

/**
 * `clauses` names the checks on each risk after ISO clauses; without it they get
 * plain names. Either way every risk is checked, so a thread that stops at a
 * control nobody has started is never called whole.
 */
export function GoldenThread({ itemLabel, canEdit, clauses = false, reasons = clauses }: { itemLabel: string; canEdit: boolean; clauses?: boolean; reasons?: boolean }): VNode {
  const [data, setData] = useState<ThreadData | null>(null);
  const [themes, setThemes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [onlyProblems, setOnlyProblems] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<Sel>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** Which link is being made in the details panel, and what is chosen so far. */
  const [linking, setLinking] = useState<{ kind: "risk" | "evidence"; id: string; ids: string[] } | null>(null);
  const [allEvidence, setAllEvidence] = useState<Evidence[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [linkError, setLinkError] = useState("");
  /** The sample library, for repairing sample risks that lost their controls, and for suggestions. */
  const [samples, setSamples] = useState<Awaited<ReturnType<typeof pack.samples>> | null>(null);
  const [repairNote, setRepairNote] = useState("");
  useEffect(() => {
    let live = true;
    pack.samples().then((x) => live && setSamples(x)).catch(() => { /* optional */ });
    return () => { live = false; };
  }, []);
  // Choosing something else closes any link in progress.
  useEffect(() => { setLinking(null); setLinkError(""); }, [sel]);
  /**
   * Drawn at the size of the space it has, one unit to one pixel. Scaling a
   * fixed drawing to fit shrank the text past reading on a laptop and cut
   * the evidence column off on the right.
   */
  const [width, setWidth] = useState(0);
  // Escape closes the details.
  useEffect(() => {
    if (!sel) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") setSel(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  useEffect(() => {
    let live = true;
    Promise.all([api.get(), pack.themes().catch(() => ({}))])
      .then(([d, t]) => {
        if (!live) return;
        setData(d);
        setThemes(t as Record<string, string>);
        // A thousand controls at once is a wall, not a map. Large frameworks
        // open on the problems; anyone can still switch to everything.
        setOnlyProblems((cur) => cur ?? d.controls.length > 150);
      })
      .catch((err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  const a = useMemo(() => (data ? analyse(data, true, { iso: clauses, reasons }) : null), [data, clauses, reasons]);
  const items = plural(itemLabel);

  const drawn = useMemo(() => {
    if (!data || !a) return null;
    const q = query.trim().toLowerCase();
    const has = (s: string): boolean => s.toLowerCase().includes(q);
    let cs = data.controls;
    let rs = data.risks;
    if (onlyProblems) {
      // A risk failing a check is a problem too, with the controls holding it up:
      // the ones not yet in place.
      const gap = (r: ThreadRisk): boolean => (a.clausesOf.get(r.id) ?? []).some((x) => x.level !== "ok");
      const holding = new Set(rs.filter(gap).flatMap((r) => r.controls));
      cs = cs.filter((c) => a.controlProblem.get(c.id) || (holding.has(c.id) && c.status !== "implemented" && c.status !== "not_applicable"));
      const keep = new Set(cs.map((c) => c.id));
      rs = rs.filter((r) => a.riskProblem.get(r.id) || gap(r) || r.controls.some((c) => keep.has(c)));
    }
    if (q) {
      const hitR = rs.filter((r) => has(`#${r.seq} ${r.title}`));
      const hitC = cs.filter((c) => has(`${c.ref} ${c.title}`) || (a.evOf.get(c.id) ?? []).some((e) => has(e.name)));
      const keep = new Set([...hitC.map((c) => c.id), ...hitR.flatMap((r) => r.controls)]);
      cs = cs.filter((c) => keep.has(c.id));
      rs = rs.filter((r) => hitR.includes(r) || r.controls.some((c) => keep.has(c)));
    }

    // Three equal columns with room for the lines between them. Below 760
    // the drawing keeps its size and the box scrolls sideways instead.
    const byStatus = (id: string): string | undefined => data.controls.find((x) => x.id === id)?.status;
    const W = Math.max(760, width || 1000);
    const gapX = Math.round(Math.min(110, Math.max(56, W * 0.075)));
    // The middle column carries a reference, a title and an owner, so it gets
    // a little more than the other two.
    // The Clauses column sits right beside the risks it belongs to: three small
    // boxes per risk, so which clause is missing is read straight off the row.
    const kW = 168, kGap = 10;
    const inner = W - 2 * gapX - kW - kGap;
    // A reference is drawn in an 11px monospace font, about 6.6px a character.
    // ISO's "A.5.1" fits the usual gap; HIPAA's "164.308(a)(1)(ii)(A)" does
    // not, and its title was drawn on top of it. The gap follows the longest
    // reference, and the middle column grows by that much, taken from the
    // risks and the evidence.
    const longestRef = data.controls.reduce((n, c) => Math.max(n, c.ref.length), 0);
    const refOff = Math.max(72, Math.ceil(longestRef * 6.6) + 18);
    const grow = refOff - 72;
    const rW = Math.floor(inner * 0.31 - grow / 2), cW = Math.floor(inner * 0.38 + grow);
    const X = { r: 0, k: rW + kGap, c: rW + kGap + kW + gapX, e: rW + kGap + kW + 2 * gapX + cW };
    const WD = { r: rW, k: kW, c: cW, e: W - X.e };
    const riskOut = X.k + WD.k;
    /** Characters that fit in a column after its label and badge, at about 7.2px each. */
    const fit = (w: number, reserved: number): number => Math.max(8, Math.floor((w - reserved) / 7.2));
    const CH = 26, CS = 30, TH = 34, RH = 30, RS = 36;
    let y = 36;
    const cy = new Map<string, number>();
    const heads: [string, number][] = [];
    let lastTheme = "";
    for (const c of cs) {
      if (c.theme !== lastTheme) { heads.push([c.theme, y]); y += TH; lastTheme = c.theme; }
      cy.set(c.id, y);
      y += CS;
    }
    const H = Math.max(y + 10, 140);
    const mid = (ids: string[]): number | null => {
      const ys = ids.map((id) => cy.get(id)).filter((v): v is number => v !== undefined);
      return ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : null;
    };
    const ry = place(rs.map((r) => mid(r.controls) ?? 36), RS, 36, H);
    const evs = data.evidence.filter((e) => e.controls.some((c) => cy.has(c)));
    const ey = place(evs.map((e) => mid(e.controls) ?? 36), RS, 36, H);
    const curve = (x1: number, y1: number, x2: number, y2: number): string =>
      `M${x1} ${y1} C${x1 + 70} ${y1},${x2 - 70} ${y2},${x2} ${y2}`;

    let paths = `<text class="gt-colh" x="${X.r}" y="16">Risks</text>` +
      `<text class="gt-colh" x="${X.k}" y="16">${clauses ? "Clauses" : "Checks"}</text>` +
      `<text class="gt-colh" x="${X.c}" y="16">${esc(items)} and who owns them</text>` +
      `<text class="gt-colh" x="${X.e}" y="16">Evidence you can show</text>`;
    let nodes = "";
    for (const [theme, hy] of heads) {
      nodes += `<text class="gt-theme" x="${X.c}" y="${hy + 21}">${esc(themes[theme] ?? theme)}</text>`;
    }
    rs.forEach((r, i) => {
      const yy = ry[i]! + RH / 2;
      const p = a.riskProblem.get(r.id);
      for (const c of r.controls) {
        const to = cy.get(c);
        if (to === undefined) continue;
        const cpb = a.controlProblem.get(c);
        const whole = cpb === null && byStatus(c) === "implemented";
        paths += `<path class="gt-p${cpb?.kind === "noproof" ? " bad" : cpb ? " warn" : whole ? " ok" : ""}" data-k="${r.id} ${c}" d="${curve(riskOut, yy, X.c, to + CH / 2)}"/>`;
      }
      const states = a.clausesOf.get(r.id) ?? [];
      const worst = states.some((x) => x.level === "bad") ? "bad" : states.some((x) => x.level === "warn") ? "warn" : "ok";
      let chips = "";
      if (states.length) {
        chips += `<path class="gt-p ${worst}" data-k="${r.id}" d="M${X.r + WD.r} ${yy} L${X.k} ${yy}"/>`;
        chips += states.map((st, k) => `<g class="gt-n gt-chip ${st.level}" data-k="${r.id}" data-type="r" data-id="${r.id}" tabindex="0" role="button" aria-label="${clauses ? `Clause ${st.clause}, ` : ""}${st.name}: ${st.level === "ok" ? "met" : st.level === "warn" ? "partly met" : "not met"}">` +
          `<title>${clauses ? `Clause ${st.clause}, ` : ""}${esc(st.name)}: ${esc(st.text)}</title>` +
          `<rect class="gt-chip-box" x="${X.k + k * 56}" y="${ry[i]! + (RH - 22) / 2}" width="52" height="22" rx="6"/>` +
          `<text x="${X.k + k * 56 + 26}" y="${ry[i]! + 20}" text-anchor="middle">${esc(st.clause)}</text></g>`).join("");
      }
      const note = states.length ? "" : p ? `<text class="gt-sm" x="${X.r + WD.r - 10}" y="${ry[i]! + 20}" text-anchor="end" style="fill:var(--red)">nothing treats it</text>`
        : r.treatment === "Accept" || r.status === "Accepted" ? `<text class="gt-sm" x="${X.r + WD.r - 10}" y="${ry[i]! + 20}" text-anchor="end">accepted</text>` : "";
      const riskOk = !p && states.length > 0 && states.every((s) => s.level === "ok");
      nodes += `<g class="gt-n${p ? " bad" : riskOk ? " ok" : ""}" data-k="${r.id}" data-type="r" data-id="${r.id}" tabindex="0" role="button" aria-label="Risk ${r.seq}: ${esc(r.title)}">` +
        `<title>${esc(r.title)}</title><rect class="gt-box" x="${X.r}" y="${ry[i]}" width="${WD.r}" height="${RH}" rx="9"/>` +
        `<text class="gt-ref" x="${X.r + 12}" y="${ry[i]! + 20}">#${r.seq}</text><text x="${X.r + 50}" y="${ry[i]! + 20}">${esc(cut(r.title, fit(WD.r, p && !states.length ? 180 : note ? 130 : 62)))}</text>${note}</g>${chips}`;
    });
    for (const c of cs) {
      const yy = cy.get(c.id)!;
      const p = a.controlProblem.get(c.id);
      const rk = (a.risksOf.get(c.id) ?? []).map((r) => r.id);
      const evidence = a.evOf.get(c.id) ?? [];
      for (const e of evidence) {
        const k = evs.indexOf(e);
        if (k < 0) continue;
        paths += `<path class="gt-p${a.evidenceOld(e) ? " warn" : p ? "" : " ok"}" data-k="${c.id} ${e.id} ${rk.join(" ")}" d="${curve(X.c + WD.c, yy + CH / 2, X.e, ey[k]! + RH / 2)}"/>`;
      }
      const cls = c.status === "not_applicable" ? " na" : p ? ` ${p.level}` : c.status === "implemented" ? " ok" : "";
      const ownerText = cut(c.owner.trim() || "no owner", 16);
      const rightW = c.status !== "implemented" ? (c.status === "not_applicable" ? 96 : 84) : p?.kind === "noproof" ? 64 : ownerText.length * 6.6 + 18;
      const right = c.status !== "implemented"
        ? `<text class="gt-sm" x="${X.c + WD.c - 10}" y="${yy + 17}" text-anchor="end">${STATUS_WORD[c.status] ?? ""}</text>`
        : p?.kind === "noproof"
          ? `<text class="gt-sm" x="${X.c + WD.c - 10}" y="${yy + 17}" text-anchor="end" style="fill:var(--red)">no evidence</text>`
          : `<text class="gt-sm gt-own" x="${X.c + WD.c - 10}" y="${yy + 17}" text-anchor="end"${c.owner.trim() ? "" : ' style="fill:var(--amber)"'}>${esc(ownerText)}</text>`;
      nodes += `<g class="gt-n${cls}" data-k="${c.id} ${rk.join(" ")} ${evidence.map((e) => e.id).join(" ")}" data-type="c" data-id="${c.id}" tabindex="0" role="button" aria-label="${esc(c.ref)} ${esc(c.title)}">` +
        `<title>${esc(c.ref)} ${esc(c.title)}</title><rect class="gt-box" x="${X.c}" y="${yy}" width="${WD.c}" height="${CH}" rx="7"/>` +
        `<text class="gt-ref" x="${X.c + 10}" y="${yy + 17}">${esc(c.ref)}</text><text x="${X.c + refOff}" y="${yy + 17}">${esc(cut(c.title, fit(WD.c, refOff + rightW)))}</text>${right}</g>`;
    }
    evs.forEach((e, i) => {
      const old = a.evidenceOld(e);
      const ctl = e.controls.filter((c) => cy.has(c));
      const rk = data.risks.filter((r) => r.controls.some((c) => ctl.includes(c))).map((r) => r.id);
      nodes += `<g class="gt-n${old ? " warn" : " ok"}" data-k="${e.id} ${ctl.join(" ")} ${rk.join(" ")}" data-type="e" data-id="${e.id}" tabindex="0" role="button" aria-label="${esc(e.name)}">` +
        `<title>${esc(e.name)}</title><rect class="gt-box" x="${X.e}" y="${ey[i]}" width="${WD.e}" height="${RH}" rx="9"/>` +
        `<text x="${X.e + 12}" y="${ey[i]! + 20}">${esc(cut(e.name, fit(WD.e, 112)))}</text>` +
        `<text class="gt-sm" x="${X.e + WD.e - 10}" y="${ey[i]! + 20}" text-anchor="end" style="fill:${old ? "var(--amber)" : "var(--green)"}">${e.ageDays === null ? "no date" : `${e.ageDays} days old`}</text></g>`;
    });
    if (!cs.length && !rs.length) {
      nodes += `<text class="gt-empty" x="${W / 2}" y="80" text-anchor="middle">${onlyProblems && !q ? "No problems. Every thread is whole." : "Nothing matches."}</text>`;
    }
    return { markup: paths + nodes, viewBox: `0 0 ${W} ${H}`, w: W, h: H };
  }, [data, a, themes, onlyProblems, query, items, width]);

  // Lighting a thread is done on the DOM directly; see the note at the top.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !drawn) return undefined;
    const light = (keys: string[] | null, self?: string): void => {
      if (!keys) {
        svg.classList.remove("focus");
        svg.querySelectorAll(".on").forEach((x) => x.classList.remove("on"));
        return;
      }
      const me = self ?? keys[0]!;
      svg.classList.add("focus");
      svg.querySelectorAll<SVGElement>(".gt-p").forEach((p) => p.classList.toggle("on", (p.dataset["k"] ?? "").split(" ").includes(me)));
      svg.querySelectorAll<SVGElement>(".gt-n").forEach((n) => {
        const k = (n.dataset["k"] ?? "").split(" ");
        n.classList.toggle("on", k.includes(me) || keys.includes(n.dataset["id"] ?? ""));
      });
    };
    const keysOf = (n: Element): string[] => ((n as SVGElement).dataset["k"] ?? "").split(" ").filter(Boolean);
    const nodeOf = (t: EventTarget | null): Element | null => (t instanceof Element ? t.closest(".gt-n[data-type]") : null);
    const pinned = sel ? svg.querySelector(`.gt-n[data-type="${sel.type}"][data-id="${sel.id}"]`) : null;
    if (pinned) light(keysOf(pinned), sel!.id); else light(null);

    const over = (e: Event): void => { if (sel) return; const n = nodeOf(e.target); light(n ? keysOf(n) : null, n ? (n as SVGElement).dataset["id"] : undefined); };
    const out = (e: MouseEvent): void => { if (!sel && !nodeOf(e.relatedTarget)) light(null); };
    const pick = (n: Element): void => {
      const type = (n as SVGElement).dataset["type"] as "r" | "c" | "e";
      const id = (n as SVGElement).dataset["id"]!;
      setSel((cur) => (cur && cur.type === type && cur.id === id ? null : { type, id }));
    };
    const click = (e: Event): void => { const n = nodeOf(e.target); if (n) pick(n); };
    const key = (e: KeyboardEvent): void => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const n = nodeOf(e.target);
      if (n) { e.preventDefault(); pick(n); }
    };
    svg.addEventListener("mouseover", over);
    svg.addEventListener("mouseout", out);
    svg.addEventListener("click", click);
    svg.addEventListener("keydown", key);
    return () => {
      svg.removeEventListener("mouseover", over);
      svg.removeEventListener("mouseout", out);
      svg.removeEventListener("click", click);
      svg.removeEventListener("keydown", key);
    };
  }, [drawn, sel]);

  /**
   * Risks added from the sample library before it kept their controls: same
   * title as a sample, nothing linked. Each is given the controls its sample
   * names. Risks somebody wrote, or that already have a control, are left alone.
   */
  const refToId = new Map((data?.controls ?? []).map((c) => [c.ref, c.id] as const));
  const sampleRefs = new Map<string, string[]>();
  for (const grp of samples?.risks ?? []) for (const it of grp.items) sampleRefs.set(String(it["title"]), (it["refs"] as string[] | undefined) ?? []);
  const repairable = (data?.risks ?? []).filter((r) => !r.controls.length && (sampleRefs.get(r.title) ?? []).some((ref) => refToId.has(ref)));
  async function repairSamples(): Promise<void> {
    setSaving(true);
    setLinkError("");
    try {
      for (const r of repairable) {
        const ids = (sampleRefs.get(r.title) ?? []).map((ref) => refToId.get(ref)).filter((x): x is string => x !== undefined);
        await risksApi.update(r.id, { controlIds: ids });
      }
      setRepairNote(`Linked ${repairable.length} ${repairable.length === 1 ? "risk" : "risks"} to the controls the sample library names for them.`);
      await reloadThread();
    } catch (err) {
      setLinkError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const suggestFor = (title: string): string[] =>
    suggestControls(title, "", samples, (data?.controls ?? []).map((c) => ({ id: c.id, label: c.ref, detail: c.title })));

  async function reloadThread(): Promise<void> {
    setData(await api.get());
  }
  async function saveRiskLinks(): Promise<void> {
    if (!linking || linking.kind !== "risk") return;
    setSaving(true);
    setLinkError("");
    try {
      await risksApi.update(linking.id, { controlIds: linking.ids });
      await reloadThread();
      setLinking(null);
    } catch (err) {
      setLinkError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }
  /** Evidence is linked from the evidence's side: add this control to each one chosen. */
  async function saveEvidenceLinks(controlId: string): Promise<void> {
    if (!linking || linking.kind !== "evidence" || !allEvidence) return;
    setSaving(true);
    setLinkError("");
    try {
      for (const id of linking.ids) {
        const e = allEvidence.find((x) => x.id === id);
        if (e) await evidenceApi.update(id, { controlIds: [...new Set([...e.control_ids, controlId])] });
      }
      await reloadThread();
      setAllEvidence(null);
      setLinking(null);
    } catch (err) {
      setLinkError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function startEvidenceLink(controlId: string): void {
    setLinking({ kind: "evidence", id: controlId, ids: [] });
    if (!allEvidence) evidenceApi.list().then((r) => setAllEvidence(r.evidence)).catch((err: Error) => setLinkError(err.message));
  }

  if (error) return html`<div class="card pad error-box">${error}</div>`;
  if (!data || !a || !drawn) return html`<div class="card pad muted">Loading…</div>`;

  if (!data.risks.length && !data.evidence.length) {
    return html`<div class="card pad">
      <h2 style="margin:0 0 6px">Nothing to join up yet</h2>
      <p class="muted" style="margin:0 0 14px">The golden thread links each risk to the ${items.toLowerCase()} that treat it, and each of those to its evidence. Record a risk, link it to a ${itemLabel.toLowerCase()}, and link evidence to that ${itemLabel.toLowerCase()}, and it appears here.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn small primary" href="#/risks">Open the risk register</a>
        <a class="btn small" href="#/evidence">Open Evidence</a>
      </div>
    </div>`;
  }

  const controlOptions = data.controls
    .filter((c) => c.status !== "not_applicable")
    .map((c) => ({ id: c.id, label: c.ref, detail: c.title }));
  const find = <T extends { id: string }>(list: T[], id: string): T | undefined => list.find((x) => x.id === id);
  const ctlName = (id: string): string => { const c = find(data.controls, id); return c ? `${c.ref} ${c.title}` : ""; };
  const go = (type: "r" | "c" | "e", id: string) => () => setSel({ type, id });
  const tag = (c: ThreadControl): VNode => {
    if (c.status === "not_applicable") return html`<span class="gt-tag na">Not applicable</span>`;
    if (c.status !== "implemented") return html`<span class="gt-tag prog">${STATUS_WORD[c.status]}</span>`;
    const p = a.controlProblem.get(c.id);
    return p ? html`<span class=${`gt-tag ${p.level}`}>${p.level === "bad" ? "Broken" : "Weak"}</span>` : html`<span class="gt-tag ok">Whole</span>`;
  };
  // Each fix opens the exact risk or control, with the box to change selected.
  const FIX: Record<Problem["kind"], (id: string) => [string, string, string]> = {
    untreated: (id) => ["Link a control to it in the risk register.", linkTo("risks", id, "controls"), "Open the risk"],
    noproof: (id) => [`Add evidence and link it to this ${itemLabel.toLowerCase()}.`, linkTo("controls", id, "evidence"), `Open the ${itemLabel.toLowerCase()}`],
    stale: (id) => ["Collect a fresh copy and update its collected date.", linkTo("controls", id, "evidence"), `Open the ${itemLabel.toLowerCase()}`],
    undated: (id) => ["Give the evidence the date it was collected.", linkTo("controls", id, "evidence"), `Open the ${itemLabel.toLowerCase()}`],
    noowner: (id) => [`Give it an owner.`, linkTo("controls", id, "owner"), "Name an owner"],
  };
  const fixBox = (p: Problem, subjectId: string): VNode => {
    const inline = canEdit && (p.kind === "untreated" || p.kind === "noproof" || p.kind === "stale" || p.kind === "undated");
    const open = linking && linking.id === subjectId;
    const what = plural(itemLabel).toLowerCase();
    return html`<div class=${`gt-problem ${p.level}`}>
      ${p.text}
      ${open
        ? html`<div class="gt-linker">
            <div class="gt-k" style="margin-top:10px">${linking!.kind === "risk" ? `Choose the ${what} that treat it` : "Choose the evidence that shows it working"}</div>
            ${linking!.kind === "risk"
              ? html`<${LinkPicker} options=${controlOptions} value=${linking!.ids}
                       suggested=${suggestFor(data.risks.find((x) => x.id === subjectId)?.title ?? "")}
                       onChange=${(ids: string[]) => setLinking({ ...linking!, ids })}
                       placeholder=${`Search ${what}…`} />`
              : allEvidence
                ? html`<${LinkPicker} options=${allEvidence
                           .filter((e) => !e.control_ids.includes(subjectId))
                           .map((e) => ({ id: e.id, label: e.name, detail: e.age_days === null ? "no date" : `${e.age_days} days old` }))}
                         value=${linking!.ids}
                         onChange=${(ids: string[]) => setLinking({ ...linking!, ids })}
                         placeholder="Search your evidence…"
                         empty=${allEvidence.length
                           ? "All your evidence is already linked here. Add new evidence instead."
                           : "You have no evidence recorded yet. Add new evidence instead."} />`
                : html`<p class="muted" style="margin:0">Loading…</p>`}
            ${linkError ? html`<div class="err" role="alert" style="margin:8px 0 0">${linkError}</div>` : null}
            <div class="gt-linker-actions">
              <button class="btn small primary" disabled=${saving || !linking!.ids.length}
                      onClick=${() => void (linking!.kind === "risk" ? saveRiskLinks() : saveEvidenceLinks(subjectId))}>
                ${saving ? "Saving…" : "Save the link"}
              </button>
              <button class="btn small" disabled=${saving} onClick=${() => setLinking(null)}>Cancel</button>
              ${linking!.kind === "evidence" ? html`<a class="btn small" href=${linkTo("controls", subjectId, "evidence")}>Add new evidence</a>` : null}
            </div>
          </div>`
        : html`<div class="gt-actions">
            ${inline
              ? html`<button class="btn small primary"
                       onClick=${() => p.kind === "untreated"
                         ? setLinking({ kind: "risk", id: subjectId, ids: data.risks.find((r) => r.id === subjectId)?.controls ?? [] })
                         : startEvidenceLink(subjectId)}>
                  ${p.kind === "untreated" ? `Link ${what}` : p.kind === "noproof" ? "Link existing evidence" : "Link newer evidence"}
                </button>`
              : null}
            <a class=${`btn small${inline ? "" : " primary"}`} href=${FIX[p.kind](subjectId)[1]}>${FIX[p.kind](subjectId)[2]}</a>
          </div>`}
    </div>`;
  };

  let detail: VNode;
  if (!sel) {
    detail = html`<h3>Click anything to see its thread</h3>
      <p class="muted">A risk shows what treats it. A ${itemLabel.toLowerCase()} shows its owner, its risks and its evidence. A piece of evidence shows everything it backs up.</p>
      ${a.broken + a.weak + a.clauseGaps
        ? html`<p class="muted">${a.broken + a.weak + a.clauseGaps} ${a.broken + a.weak + a.clauseGaps === 1 ? "problem" : "problems"} to fix. ${onlyProblems ? "" : html`Switch to <b>Only problems</b> to see just those.`}</p>`
        : html`<p class="muted">Every thread is whole.</p>`}`;
  } else if (sel.type === "r") {
    const r = find(data.risks, sel.id);
    const p = r && a.riskProblem.get(r.id);
    detail = !r ? html`<p class="muted">Not found.</p>` : html`
      <div class="gt-eyebrow">Risk #${r.seq} · ${r.treatment}</div><h3>${r.title}</h3>
      <div class="gt-k">Treated by${canEdit && r.controls.length && !(linking && linking.id === r.id) ? html` <button class="gt-link gt-change" onClick=${() => setLinking({ kind: "risk", id: r.id, ids: r.controls })}>change</button>` : null}</div>
      ${linking && linking.id === r.id && !p ? html`<div class="gt-problem ok"><${LinkPicker} options=${controlOptions} value=${linking.ids} suggested=${suggestFor(r.title)}
          onChange=${(ids: string[]) => setLinking({ ...linking, ids })} placeholder=${`Search ${plural(itemLabel).toLowerCase()}…`} />
          ${linkError ? html`<div class="err" role="alert">${linkError}</div>` : null}
          <div class="gt-linker-actions"><button class="btn small primary" disabled=${saving} onClick=${() => void saveRiskLinks()}>${saving ? "Saving…" : "Save the link"}</button>
          <button class="btn small" onClick=${() => setLinking(null)}>Cancel</button></div></div>` : null}
      ${r.controls.length
        ? r.controls.map((id) => { const c = find(data.controls, id); return c ? html`<div class="gt-item">${tag(c)} <button class="gt-link" onClick=${go("c", id)}><span class="mono">${c.ref}</span> ${c.title}</button></div>` : null; })
        : html`<div class="gt-item muted">Nothing linked.</div>`}
      ${(a.clausesOf.get(r.id) ?? []).length
        ? html`<div class="gt-k">${clauses ? "Clauses" : "Checks"}</div>
            ${a.clausesOf.get(r.id)!.map((s) => html`<div class="gt-item gt-clause">
                <span class=${`gt-dot ${s.level}`}></span>
                <span class="gt-clause-text">${clauses ? html`<b>${s.clause}</b> ${s.name}` : html`<b>${s.name}</b>`}. <span class="muted">${s.text}</span>
                  ${s.fix ? html`<span class="gt-howto"><b>To fix:</b> ${s.fix.how}
                    ${s.fix.goto && canEdit ? html` <a class="btn small" href=${s.fix.goto}>${s.fix.label}</a>` : null}</span>` : null}
                </span>
              </div>`)}`
        : null}
      ${p ? fixBox(p, r.id)
        : r.controls.length && r.controls.every((id) => !a.controlProblem.get(id))
          ? ((a.clausesOf.get(r.id) ?? []).some((x) => x.level !== "ok")
            ? html`<div class="gt-problem warn">Not whole yet. The ${clauses ? "clauses" : "checks"} above say what to do next.</div>`
            : html`<div class="gt-problem ok">Whole thread. An auditor following this risk finds everything in place.</div>`)
          : r.controls.length ? html`<div class="gt-problem warn">One of the ${items.toLowerCase()} treating it has a problem. Click it to see what.</div>` : null}`;
  } else if (sel.type === "c") {
    const c = find(data.controls, sel.id);
    const p = c && a.controlProblem.get(c.id);
    const rk = c ? a.risksOf.get(c.id) ?? [] : [];
    const evidence = c ? a.evOf.get(c.id) ?? [] : [];
    detail = !c ? html`<p class="muted">Not found.</p>` : html`
      <div class="gt-eyebrow">${itemLabel} <span class="mono">${c.ref}</span></div><h3>${c.title}</h3>
      <div class="gt-item">${tag(c)} <span class="muted">Owner: ${c.owner.trim() || "nobody"}</span></div>
      <div class="gt-k">Risks it treats</div>
      ${rk.length
        ? rk.map((r) => html`<div class="gt-item"><button class="gt-link" onClick=${go("r", r.id)}>#${r.seq} ${r.title}</button></div>`)
        : html`<div class="gt-item muted">${c.status === "not_applicable" ? "None. It is excluded." : "None linked. That is fine when there is another reason for it, such as a law or a contract."}</div>`}
      <div class="gt-k">Evidence</div>
      ${evidence.length
        ? evidence.map((e) => html`<div class="gt-item"><button class="gt-link" onClick=${go("e", e.id)}>${e.name}</button> <span class=${`gt-tag ${a.evidenceOld(e) ? "warn" : "ok"}`}>${e.ageDays === null ? "no date" : `${e.ageDays} days`}</span></div>`)
        : html`<div class="gt-item muted">${c.status === "implemented" ? "None linked." : c.status === "not_applicable" ? "Not needed." : "Not yet."}</div>`}
      ${p ? fixBox(p, c.id) : c.status === "implemented" ? html`<div class="gt-problem ok">Whole thread. Evidence is current and someone owns it.</div>` : null}`;
  } else {
    const e = find(data.evidence, sel.id);
    const old = e ? a.evidenceOld(e) : false;
    detail = !e ? html`<p class="muted">Not found.</p>` : html`
      <div class="gt-eyebrow">Evidence</div><h3>${e.name}</h3>
      <div class="gt-item"><span class=${`gt-tag ${old ? "warn" : "ok"}`}>${e.ageDays === null ? "No collected date" : `${e.ageDays} days old`}</span></div>
      <div class="gt-k">Backs up ${e.controls.length} ${e.controls.length === 1 ? itemLabel.toLowerCase() : items.toLowerCase()}</div>
      ${e.controls.map((id) => html`<div class="gt-item"><button class="gt-link" onClick=${go("c", id)}>${ctlName(id)}</button></div>`)}
      ${old
        ? html`<div class="gt-problem warn">${e.ageDays === null ? "Without a date it cannot show anything is working now." : `Over ${data.staleDays} days old.`} One fresh copy fixes every ${itemLabel.toLowerCase()} it backs up.<div><a class="btn small primary" href=${linkTo("evidence", e.id, "collected")}>Update this evidence</a></div></div>`
        : html`<div class="gt-problem ok">Current.</div>`}`;
  }

  return html`<div class="card pad gt">
    <p class="muted" style="margin:0;max-width:78ch">
      A ${itemLabel.toLowerCase()} is a promise, such as "we back up our data". Evidence is the document that shows you keep it. This map joins each risk to the ${items.toLowerCase()} that treat it and the evidence behind them: the line an auditor follows. A break anywhere along it becomes a finding. Point at anything to trace it; click to see the details.
    </p>
    ${canEdit && repairable.length
      ? html`<div class="gt-repair">
          <div><b>${repairable.length} of your ${repairable.length === 1 ? "risk" : "risks"}</b> came from the sample library but ${repairable.length === 1 ? "has" : "have"} no ${items.toLowerCase()} linked.
            The library knows which ${items.toLowerCase()} treat them.</div>
          <button class="btn small primary" disabled=${saving} onClick=${() => void repairSamples()}>${saving ? "Linking…" : `Link them to their ${items.toLowerCase()}`}</button>
        </div>`
      : repairNote ? html`<div class="gt-repair ok">${repairNote}</div>` : null}
    <div class="gt-bar">
      <div class="gt-stats">
        <div class="ok"><b>${a.whole}</b>${items.toLowerCase()} with a whole thread</div>
        <div class=${a.broken ? "bad" : ""}><b>${a.broken}</b>broken links</div>
        <div class=${a.weak ? "warn" : ""}><b>${a.weak}</b>weak links</div>
        <div><b>${a.unlinked}</b>${items.toLowerCase()} not linked to a risk</div>
        <div class=${a.clauseGaps ? "warn" : "ok"}><b>${a.clauseGaps}</b>risks not meeting ${clauses ? "a clause" : "every check"}</div>
      </div>
      <div class="gt-tools">
        <div class="gt-seg" role="group" aria-label="Show">
          <button aria-pressed=${!onlyProblems} onClick=${() => setOnlyProblems(false)}>Everything</button>
          <button aria-pressed=${!!onlyProblems} onClick=${() => setOnlyProblems(true)}>Only problems</button>
        </div>
        <input type="search" class="gt-search" placeholder=${`Find a risk, ${itemLabel.toLowerCase()} or evidence`}
               aria-label="Find" value=${query} onInput=${(e: Event) => setQuery((e.target as HTMLInputElement).value)} />
      </div>
    </div>
    <div class="gt-key">
      <span><i class="ok"></i> Satisfied</span>
      <span><i class="bad"></i> Broken: nothing treats a risk, or no evidence</span>
      <span><i class="warn"></i> Weak: evidence over ${data.staleDays} days old or undated, or no owner</span>
      <span><i class="na"></i> Not applicable</span>
      ${clauses ? html`<span>Clauses: 6.1.2, 6.1.3 and 8.3 beside each risk, in that order</span>`
        : html`<span>Checks beside each risk: Owner, controls Chosen, controls In place</span>`}
      <span class="gt-key-hint">${sel ? "Press Esc or click again to close the details." : "Click anything for its details."}</span>
    </div>
    <div class="gt-wrap" ref=${wrapRef}>
      <svg ref=${svgRef} class="gt-map" viewBox=${drawn.viewBox} width=${drawn.w} height=${drawn.h} role="img"
           aria-label=${`Risks on the left, ${items.toLowerCase()} in the middle, evidence on the right, joined by lines. Broken links are dashed red, weak ones dashed amber.`}
           dangerouslySetInnerHTML=${{ __html: drawn.markup }}></svg>
    </div>
    ${sel
      ? html`<aside class="gt-drawer" aria-live="polite" aria-label="Details">
          <button class="gt-close" aria-label="Close the details" onClick=${() => setSel(null)}>×</button>
          ${detail}
        </aside>`
      : null}
  </div>`;
}

/** The golden thread in one line, for the Get ready screen. */
export function ThreadSummary({ itemLabel }: { itemLabel: string }): VNode | null {
  const [s, setS] = useState<ReturnType<typeof analyse> | null>(null);
  useEffect(() => {
    let live = true;
    api.get().then((d) => live && (d.risks.length || d.evidence.length) && setS(analyse(d, true, { iso: false, reasons: false }))).catch(() => { /* optional */ });
    return () => { live = false; };
  }, []);
  if (!s) return null;
  const problems = s.broken + s.weak;
  return html`<a class="card pad gt-summary" href="#/risks/thread">
    <div>
      <div class="gt-eyebrow">The golden thread</div>
      <div class="gt-summary-line">
        ${problems
          ? html`<b class=${s.broken ? "bad" : "warn"}>${problems} ${problems === 1 ? "link needs" : "links need"} fixing</b> between your risks, your ${plural(itemLabel).toLowerCase()} and the evidence.`
          : s.clauseGaps
            ? html`<b class="warn">${s.clauseGaps} ${s.clauseGaps === 1 ? "risk is" : "risks are"} not fully treated yet.</b> Open the thread to see what each one needs next.`
            : html`<b class="ok">Every thread is whole.</b> Each risk is treated, and the evidence is current.`}
      </div>
    </div>
    <span class="btn small">Open the golden thread</span>
  </a>`;
}
