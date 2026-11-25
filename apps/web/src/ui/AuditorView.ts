import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { walkTo } from "./AuditorWalk.js";
import {
  controls, evidence, risks, programme, readiness, reports, policies, findings, reviews, training, vendors, objectives, parties,
  type KeyDate, type RegisterRow,
} from "../persistence/apiClient.js";

/**
 * The Auditor view: one page to walk a certification auditor through, grouped
 * the way an ISO/IEC 27001 audit reads (the management system, the controls and
 * their proof, then how the system is run), in the same shape as every Offset
 * product's Auditor view.
 *
 * Quiet by design: each item is one line (a dot, a name, one status). Click it
 * for the detail; hover over the ⓘ for the clause behind it. Everything is
 * read from the product's own records, so it is true the moment it is shown.
 */

type Tone = "ok" | "warn" | "bad";
interface Step { id: string; tone: Tone; value: string; detail: string; rows?: { label: string; value: string; tone?: Tone }[] }

/** Each step: its name, the screen it opens, the clause behind it, and its group. */
const STEPS: Record<string, { title: string; route: string; tip: string; group: "system" | "controls" | "run" }> = {
  scope: { title: "ISMS scope", route: "isms", tip: "Clause 4.3", group: "system" },
  parties: { title: "Interested parties", route: "parties", tip: "Clause 4.2", group: "system" },
  method: { title: "Risk assessment method", route: "isms", tip: "Clause 6.1.2", group: "system" },
  soa: { title: "Statement of Applicability", route: "soa", tip: "Clause 6.1.3 d", group: "system" },
  controls: { title: "Annex A controls", route: "controls", tip: "Annex A, clause 6.1.3", group: "controls" },
  evidence: { title: "Evidence", route: "evidence", tip: "Clause 7.5, 9.1", group: "controls" },
  gaps: { title: "Controls with nothing to prove them", route: "gaps", tip: "Clause 9.1", group: "controls" },
  findings: { title: "Findings and corrective action", route: "findings", tip: "Clause 10.2", group: "controls" },
  policies: { title: "Policies", route: "policies", tip: "Clause 5.2, 7.5", group: "run" },
  risks: { title: "Risk register", route: "risks", tip: "Clause 6.1.2, 6.1.3, 8.2, 8.3", group: "run" },
  objectives: { title: "Objectives", route: "objectives", tip: "Clause 6.2", group: "run" },
  training: { title: "Awareness and training", route: "training", tip: "Clause 7.2, 7.3", group: "run" },
  suppliers: { title: "Suppliers", route: "vendors", tip: "Annex A 5.19 to 5.22", group: "run" },
  internal: { title: "Internal audit", route: "reviews", tip: "Clause 9.2", group: "run" },
  review: { title: "Management review", route: "reviews", tip: "Clause 9.3", group: "run" },
  trail: { title: "Audit trail", route: "audit", tip: "Clause 7.5.3", group: "run" },
};
const GROUPS: { id: "system" | "controls" | "run"; title: string }[] = [
  { id: "system", title: "The management system" },
  { id: "controls", title: "Controls and evidence" },
  { id: "run", title: "How it is run" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string | null | undefined): string => (iso ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "");
const s = (v: unknown): string => String(v ?? "");
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const toneOf = (pct: number): Tone => (pct >= 80 ? "ok" : pct > 0 ? "warn" : "bad");

interface Data {
  cs: Awaited<ReturnType<typeof controls.summary>>;
  ev: Awaited<ReturnType<typeof evidence.summary>>;
  rs: Awaited<ReturnType<typeof risks.summary>>;
  prog: { scope: string; methodology: string };
  key: KeyDate | null;
  rows: Record<string, RegisterRow[]>;
}

async function load(): Promise<Data> {
  const [cs, ev, rs, prog, ready] = await Promise.all([
    controls.summary(), evidence.summary(), risks.summary(), programme.get(),
    readiness.dashboard().catch(() => null),
  ]);
  const regs = { policies, findings, reviews, training, vendors, objectives, parties } as const;
  const rows: Record<string, RegisterRow[]> = {};
  await Promise.all(Object.entries(regs).map(async ([k, api]) => { rows[k] = await api.list().catch(() => []); }));
  return { cs, ev, rs, prog, key: ready?.keyDate ?? null, rows };
}

function stepsOf(d: Data, canSeeTrail: boolean): Step[] {
  const { cs, ev, rs, prog, rows } = d;
  const out: Step[] = [];
  const written = (t: string): boolean => t.trim().length > 0;
  out.push({ id: "scope", tone: written(prog.scope) ? "ok" : "bad", value: written(prog.scope) ? "Written" : "Not written yet",
    detail: "What the management system covers, and what is left out. The certificate quotes it." });
  out.push({ id: "parties", tone: rows["parties"]!.length ? "ok" : "warn", value: rows["parties"]!.length ? plural(rows["parties"]!.length, "party", "parties") : "None recorded",
    detail: "Who has a stake in your security, and what they need from you." });
  out.push({ id: "method", tone: written(prog.methodology) ? "ok" : "bad", value: written(prog.methodology) ? "Written" : "Not written yet",
    detail: "How risk is identified, scored and accepted, and who decides." });
  const excluded = cs.byStatus["not_applicable"] ?? 0;
  out.push({ id: "soa", tone: cs.applicable ? "ok" : "warn", value: `${cs.applicable} of ${cs.applicable + excluded} apply`,
    detail: `Every control, whether it applies, why, and how far it is implemented.${excluded ? ` ${plural(excluded, "control")} excluded.` : ""}` });
  const inPlace = cs.applicable ? Math.round((cs.implemented * 100) / cs.applicable) : 0;
  out.push({ id: "controls", tone: toneOf(inPlace), value: `${cs.implemented} of ${cs.applicable} in place`,
    detail: `${inPlace}% of the controls in scope are implemented.` });
  const old = (ev.byFreshness["stale"] ?? 0) + (ev.byFreshness["due"] ?? 0);
  out.push({ id: "evidence", tone: old ? "warn" : ev.total ? "ok" : "bad", value: ev.total ? (old ? `${old} to refresh` : `${ev.total} current`) : "None yet",
    detail: `${plural(ev.total, "piece")} of evidence, kept with its date and who owns it.` });
  const gaps = ev.controlsImplementedWithoutEvidence;
  out.push({ id: "gaps", tone: gaps ? "bad" : "ok", value: gaps ? `${gaps} to prove` : "None",
    detail: "Controls marked implemented that have nothing attached to prove it." });
  const fs = rows["findings"]!;
  const openF = fs.filter((r) => s(r["status"]) !== "Closed").length;
  out.push({ id: "findings", tone: openF ? "bad" : "ok", value: fs.length ? (openF ? `${openF} open` : `${fs.length} closed`) : "None raised",
    detail: "Nonconformities and observations raised, and what closed each one.",
    rows: fs.filter((r) => s(r["status"]) !== "Closed").slice(0, 6).map((r) => ({ label: s(r["title"]), value: s(r["status"]), tone: "warn" as Tone })) });
  const ps = rows["policies"]!;
  const approved = ps.filter((r) => s(r["status"]) === "Approved").length;
  out.push({ id: "policies", tone: ps.length && approved === ps.length ? "ok" : ps.length ? "warn" : "bad", value: ps.length ? `${approved} of ${ps.length} approved` : "None recorded",
    detail: "The documents that set out how security is run, with an owner, a version and a review date." });
  const crit = rs.byBand["critical"] ?? 0;
  const elev = rs.byBand["elevated"] ?? 0;
  out.push({ id: "risks", tone: crit ? "bad" : elev ? "warn" : rs.total ? "ok" : "bad", value: rs.total ? plural(rs.total, "risk") : "None recorded",
    detail: crit || elev ? `${crit} critical and ${elev} elevated.` : "Scored, treated and linked to the controls that mitigate them." });
  const os = rows["objectives"]!;
  const behind = os.filter((r) => ["At risk", "Missed"].includes(s(r["status"]))).length;
  out.push({ id: "objectives", tone: !os.length ? "warn" : behind ? "warn" : "ok", value: os.length ? (behind ? `${behind} behind` : `${os.length} on track or met`) : "None set",
    detail: "What the management system is aiming at, and whether it is getting there." });
  const ts = rows["training"]!;
  const done = ts.filter((r) => s(r["result"]) === "Completed").length;
  out.push({ id: "training", tone: ts.length && done === ts.length ? "ok" : ts.length ? "warn" : "warn", value: ts.length ? `${done} of ${ts.length} completed` : "None recorded",
    detail: "Who was trained, on what, and when it is due again." });
  out.push({ id: "suppliers", tone: rows["vendors"]!.length ? "ok" : "warn", value: rows["vendors"]!.length ? plural(rows["vendors"]!.length, "supplier") : "None recorded",
    detail: "Who you rely on, what they hold, and what they showed you." });
  const rv = rows["reviews"]!;
  const held = (kind: string): { held: number; planned: number } => ({
    held: rv.filter((r) => s(r["kind"]) === kind && s(r["status"]) === "Completed").length,
    planned: rv.filter((r) => s(r["kind"]) === kind && ["Planned", "In progress"].includes(s(r["status"]))).length,
  });
  const ia = held("Internal audit"); const mr = held("Management review");
  out.push({ id: "internal", tone: ia.held ? "ok" : ia.planned ? "warn" : "bad", value: ia.held ? `${ia.held} held` : ia.planned ? "Planned" : "None held",
    detail: "The management system audited from inside, before the certification auditor comes." });
  out.push({ id: "review", tone: mr.held ? "ok" : mr.planned ? "warn" : "bad", value: mr.held ? `${mr.held} held` : mr.planned ? "Planned" : "None held",
    detail: "Top management reviewing the management system, with its inputs and decisions." });
  if (canSeeTrail) out.push({ id: "trail", tone: "ok", value: "Kept", detail: "Who did what, and when. Nothing in it can be changed." });
  return out;
}

export function AuditorView({ framework, isAuditor, canSeeTrail }: { framework: string; isAuditor: boolean; canSeeTrail: boolean }): VNode {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState("");
  const [reportList, setReportList] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    load().then(setData).catch((e: Error) => setError(e.message));
    reports.list().then((r) => setReportList(r.map((x) => ({ id: x.id, title: x.title })))).catch(() => {});
  }, []);
  useEffect(() => {
    const close = (e: MouseEvent): void => { if (!(e.target as HTMLElement).closest(".avc-dl")) setMenu(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  if (error && !data) return html`<div class="card pad err">${error}</div>`;
  if (!data) return html`<div class="card pad muted">Loading…</div>`;

  const steps = stepsOf(data, canSeeTrail);
  const { cs, ev, key } = data;
  const inPlace = cs.applicable ? Math.round((cs.implemented * 100) / cs.applicable) : 0;
  const ps = data.rows["policies"]!;
  const approved = ps.filter((r) => s(r["status"]) === "Approved").length;
  const fs = data.rows["findings"]!;
  const openF = fs.filter((r) => s(r["status"]) !== "Closed").length;
  const covered = cs.implemented ? Math.round(((cs.implemented - ev.controlsImplementedWithoutEvidence) * 100) / cs.implemented) : 0;

  // Opening a step starts the walk-through: every screen then carries a bar back to this page.
  const walk = steps.map((x) => ({ title: STEPS[x.id]!.title, route: STEPS[x.id]!.route }));
  const go = (id: string): void => {
    const i = walk.findIndex((w) => w.title === STEPS[id]!.title);
    if (i >= 0) walkTo(walk, i);
  };

  const download = async (id: string): Promise<void> => {
    setMenu(false);
    try {
      const { blob, filename } = await reports.download(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { setError((e as Error).message); }
  };

  const kpi = (n: string, of: string | null, label: string, pct: number, color: string, tip: string) => html`<div class="avc-kpi" data-tip=${tip}>
    <b>${n}${of ? html`<span>/${of}</span>` : null}</b><small>${label}</small>
    <div class="avc-bar"><i style=${`width:${Math.max(0, Math.min(100, pct))}%;background:${color}`}></i></div></div>`;

  return html`<div class="avc">
    ${error ? html`<div class="error-box" role="alert">${error}</div>` : null}
    <div class="avc-head">
      <div>
        <h2>${framework} certification audit</h2>
        <p class="muted">${key ? `${key.title} · ${day(key.date)}${key.ledBy ? ` · ${key.ledBy}` : ""}` : "No certification audit booked yet"}</p>
      </div>
      ${isAuditor ? html`<span class="avc-chip" data-tip="You can read everything and change nothing.">Read only</span>` : null}
      <span class="avc-sp"></span>
      ${reportList.length
        ? html`<div class="avc-dl">
            <button type="button" class="btn primary" aria-expanded=${menu} onClick=${() => setMenu(!menu)}>Download ▾</button>
            ${menu ? html`<div class="avc-menu" role="menu">
              ${reportList.slice(0, 6).map((r) => html`<a href="#" key=${r.id} role="menuitem" onClick=${(e: Event) => { e.preventDefault(); void download(r.id); }}>${r.title} <span>PDF</span></a>`)}
            </div>` : null}
          </div>`
        : null}
    </div>

    <div class="avc-kpis">
      ${kpi(String(cs.implemented), String(cs.applicable), "Controls in place", inPlace, "var(--green)", "Annex A controls in scope that are implemented.")}
      ${kpi(String(approved), String(ps.length), "Policies approved", ps.length ? (approved / ps.length) * 100 : 0, "var(--brand)", "Documents with an approval on record.")}
      ${kpi(`${covered}%`, null, "Controls with evidence", covered, "var(--green)", "Implemented controls that have something attached to prove them.")}
      ${kpi(String(openF), null, openF ? "Findings open" : "Findings", fs.length ? ((fs.length - openF) / fs.length) * 100 : 100, openF ? "#C47A06" : "var(--green)", "Nonconformities and observations not yet closed.")}
    </div>

    <div class="avc-tabs" role="tablist">
      <button type="button" role="tab" aria-selected="true" class="on">Walk-through</button>
    </div>

    ${GROUPS.map((g) => html`<div key=${g.id}>
      <div class="avc-group">${g.title}</div>
      <div class="avc-list">${steps.filter((x) => STEPS[x.id]!.group === g.id).map((x) => {
        const m = STEPS[x.id]!;
        const isOpen = open === x.id;
        return html`<div class=${`avc-row${isOpen ? " open" : ""}`} key=${x.id} data-step=${x.id}>
          <button type="button" class="avc-rh" aria-expanded=${isOpen} onClick=${() => setOpen(isOpen ? null : x.id)}>
            <span class=${`avc-dot ${x.tone}`}></span>
            <span class="avc-name">${m.title}<span class="avc-i" data-tip=${`${m.tip}. ${x.detail}`}>i</span></span>
            <span class="avc-val">${x.value}</span><span class="avc-chev" aria-hidden="true">›</span>
          </button>
          ${isOpen ? html`<div class="avc-rb">
            <p>${x.detail}</p>
            ${x.rows?.length ? html`<table class="avc-t"><tbody>${x.rows.map((r, i) => html`<tr key=${i}><td>${r.label}</td>
              <td class="r"><span class=${`avc-tag ${r.tone ?? "warn"}`}>${r.value}</span></td></tr>`)}</tbody></table>` : null}
            <a class="avc-open" href=${`#/${m.route}`} onClick=${(e: Event) => { e.preventDefault(); go(x.id); }}>Open ${m.title} →</a>
          </div>` : null}
        </div>`;
      })}</div></div>`)}
  </div>`;
}
