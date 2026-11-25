import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import {
  controlTests, organisation, programme, readiness, reviews,
  type Journey, type JourneyTask, type LikelyFinding, type Readiness,
} from "../persistence/apiClient.js";

/**
 * The readiness parts of Plan: the progress panel, the in-card actions
 * for the steps that can be done without leaving the screen, "If the auditor
 * came today", what to fix first, quick wins and bulk changes. Ported from
 * Offset Attest, where the design was built for SOC.
 *
 * Every action here changes the real records. Steps the product checks for
 * itself turn green because the data changed, not because a box was ticked.
 */

/** Short stage names for the stepper, where the full ones do not fit. */
const SHORT: Record<string, string> = {
  setup: "Set up", scope: "Scope", lead: "Leadership", risk: "Risks", soa: "SoA",
  prove: "Prove it", check: "Check", certify: "Certify",
  assess: "Assess", write: "Write it", improve: "Improve",
};

const go = (route: string): void => { window.location.hash = `#/${route}`; };

/** "CYBER SECURITY LEADERSHIP AND GOVERNANCE (3.1)" as "3.1 Leadership and governance"; see the server's tidyTheme. */
function tidyTheme(v: string): string {
  if (v !== v.toUpperCase() || !/[A-Z]/.test(v)) return v;
  const num = /\(([\d.]+)\)\s*$/.exec(v)?.[1];
  const words = v.replace(/\([^)]*\)\s*$/, "").replace(/^CYBER SECURITY\s+/, "").trim().toLowerCase();
  const name = words.charAt(0).toUpperCase() + words.slice(1);
  return num ? `${num} ${name}` : name;
}
const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

// ── the progress header and the rest of the stage ────────────────────────────

/**
 * The top of Plan, in one short card: how far along, three facts that
 * matter (the audit, likely nonconformities, quick fixes), the stages in one
 * line, and the whole plan behind a button. The shape is Offset Attest's.
 */
export function ProgressPanel({ plan, ready, current, onPick, snoozed, next }: {
  /** The plan's next move, said once, quietly, under the stages; onGo when another step is open below. */
  next?: { title: string; n: number; onGo?: () => void; putOff: number };
  plan: Journey;
  ready: Readiness | null;
  current: JourneyTask | undefined;
  onPick: (taskId: string) => void;
  snoozed: Set<string>;
}): VNode {
  const [open, setOpen] = useState(false);
  const stageOf = plan.stages.find((s) => s.tasks.some((t) => t.id === current?.id)) ?? plan.stages.find((s) => !s.complete) ?? plan.stages[0]!;
  const si = plan.stages.indexOf(stageOf);
  const k = ready?.keyDate ?? null;
  const w = ready?.words;
  const exc = ready?.findings.length ?? 0;
  const icon = (t: JourneyTask): [string, string, string] =>
    t.state === "done" ? ["d", "✓", "Done"]
      : t.state === "not_applicable" ? ["n", "–", "Does not apply"]
      : t.id === current?.id ? ["c", "▶", "Next"]
      : snoozed.has(t.id) ? ["s", "↻", "Tomorrow"]
      : ["t", "", t.automatic ? "Checked for you" : "To do"];

  // Steps done, drawn as a small ring: 15 is the radius, so the ring is 2πr long.
  const ring = 2 * Math.PI * 15;
  const days = k && k.daysTo >= 0 ? k.daysTo : null;
  return html`<div class="card sr-plan gr-head">
    <div class="gr-row">
      <div class="gr-left">
        <div class="gr-top">
          <div class="sr-lbl">${plan.title}</div>
          <button type="button" class=${`gr-planbtn${open ? " open" : ""}`} aria-expanded=${open} onClick=${() => setOpen((v) => !v)}>
            ${open ? "Hide the plan" : "See the whole plan"} <span class="sr-chevron" aria-hidden="true">▾</span>
          </button>
        </div>
        <div class="sr-stepper gr-steps">
          ${plan.stages.map((s, i) => {
            const first = s.tasks.find((t) => t.state === "outstanding") ?? s.tasks[0];
            return html`<button type="button" key=${s.id} class=${`sr-stp${s.complete ? " done" : ""}${i === si ? " now" : ""}`}
                title=${`${s.name}: ${s.done} of ${s.applicable} done`} onClick=${() => first && onPick(first.id)}>
              <span class="sr-dot">${s.complete ? "✓" : i + 1}</span>
              <span>${SHORT[s.id] ?? s.name}</span>
              <span class="sr-bar"><i style=${`width:${s.pct}%`}></i></span>
              <span class="sr-of">${s.done} of ${s.applicable}</span>
            </button>`;
          })}
        </div>
        ${next
          ? html`<div class="gr-nextline">
              <span class="gnl-label">Next move</span>
              <span class="gnl-title">${next.title}</span>
              <span class="muted">· step ${next.n}${next.putOff ? ` · ${next.putOff} put off until tomorrow` : ""}</span>
              ${next.onGo
                ? html`<button type="button" class="linkish gnl-go" onClick=${next.onGo}>Go to it →</button>`
                : html`<span class="muted gnl-here">· open below</span>`}
            </div>`
          : null}
      </div>
      <aside class="gr-sum" aria-label="Where you stand">
        <div class="gr-n">
          <svg class="gr-ring" viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="15" fill="none" stroke="var(--line)" stroke-width="4" />
            ${plan.pct > 0
              ? html`<circle cx="18" cy="18" r="15" fill="none" stroke="var(--green)" stroke-width="4" stroke-linecap="round"
                  stroke-dasharray=${`${(ring * plan.pct) / 100} ${ring}`} transform="rotate(-90 18 18)" />`
              : null}
            <text x="18" y="21.5" text-anchor="middle">${plan.pct}%</text>
          </svg>
          <div><b>${plan.done} of ${plan.applicable}</b><span class="muted">steps done</span></div>
        </div>
        <div class="gr-facts">
          ${w
            ? html`<a class=${`gr-fact${days !== null ? " ok" : ""}`} href="#/reviews"><span><i></i>${days !== null ? `Until your ${w.keyDate}` : capital(w.keyDate)}</span><b>${days !== null ? `${days} day${days === 1 ? "" : "s"}` : k ? `${-k.daysTo} day${k.daysTo === -1 ? "" : "s"} ago` : "Not booked"}</b></a>`
            : null}
          ${ready && w ? html`<a class=${`gr-fact${exc ? " bad" : " ok"}`} href="#/dashboard"><span><i></i>Likely ${exc === 1 ? w.finding : w.findings}</span><b>${exc}</b></a>` : null}
          ${ready ? html`<a class="gr-fact" href="#/controls"><span><i></i>Quick fixes</span><b>${ready.quickWins.length}</b></a>` : null}
        </div>
      </aside>
    </div>
    ${open
      ? html`<div class="sr-planlist">
          ${plan.stages.map((s, i) => html`<div class="sr-pstage" key=${s.id}>
            <div class="sr-pstage-h"><span>${i + 1}. ${s.name}</span>
              <span class=${`pill ${s.complete ? "green" : i === si ? "blue" : "slate"}`}>${s.done} of ${s.applicable}</span></div>
            ${s.tasks.map((t) => {
              const [cls, mark, label] = icon(t);
              return html`<button type="button" key=${t.id} class=${`sr-ptask${t.id === current?.id ? " cur" : ""}`} onClick=${() => onPick(t.id)}>
                <span class=${`sr-ic ${cls}`}>${mark}</span><span class="sr-pt">${t.title}</span><span class="muted">${label}</span>
              </button>`;
            })}
          </div>`)}
        </div>`
      : null}
  </div>`;
}

/** The rest of the stage you are in, beside your next move: every step, one click away. */
export function UpNext({ plan, current, onPick, snoozed, embedded = false }: {
  plan: Journey;
  /** Drawn inside the step card rather than as a card of its own. */
  embedded?: boolean;
  current: JourneyTask | undefined;
  onPick: (taskId: string) => void;
  snoozed: Set<string>;
}): VNode | null {
  const stage = plan.stages.find((s) => s.tasks.some((t) => t.id === current?.id)) ?? plan.stages.find((s) => !s.complete);
  if (!stage) return null;
  const si = plan.stages.indexOf(stage);
  const left = stage.tasks.filter((t) => t.state === "outstanding").length;
  const nextStage = plan.stages.slice(si + 1).find((s) => !s.complete);
  const line = (t: JourneyTask): string =>
    t.state === "done" ? "Done" : t.state === "not_applicable" ? "Does not apply"
      : snoozed.has(t.id) ? "Put off until tomorrow" : t.automatic ? "Ticks itself when the records show it" : (t.why.split(/(?<=\.)\s/)[0] ?? "");
  return html`<div class=${embedded ? "gr-next gr-aside" : "card pad gr-next"}>
    <div class="sr-lbl">Up next in ${stage.name}${left ? ` · ${left} left` : " · all done"}</div>
    <ul>${stage.tasks.map((t) => html`<li key=${t.id}>
      <button type="button" class=${`gr-task${t.id === current?.id ? " cur" : ""}`} onClick=${() => onPick(t.id)}>
        <span class=${`gr-ck ${t.state === "done" ? "d" : t.state === "not_applicable" ? "n" : t.id === current?.id ? "c" : ""}`}>${t.state === "done" ? "✓" : t.state === "not_applicable" ? "–" : ""}</span>
        <span class="gr-tt"><b>${t.title}</b><small>${line(t)}</small></span>
        <span class="gr-go" aria-hidden="true">›</span>
      </button></li>`)}</ul>
    ${nextStage ? html`<button type="button" class="linkish gr-after" onClick=${() => {
      const first = nextStage.tasks.find((t) => t.state === "outstanding") ?? nextStage.tasks[0];
      if (first) onPick(first.id);
    }}>Then: ${nextStage.name} →</button>` : null}
  </div>`;
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// ── in-card actions: the steps that can be done here ─────────────────────────

/**
 * Whether a step can be done inside the card, and how to say so. Keyed by the
 * pack's step ids, so a step only one framework has simply never appears in
 * the other.
 */
export const INLINE: Record<string, string> = {
  "setup.branding": "Fill it in here",
  "scope.written": "Write it here",
  "risk.method": "Write it here",
  "soa.owners": "Do it here",
  "certify.body": "Fill it in here",
};

export function InlineAction({ taskId, canEdit, themes, ledBy, onDone }: {
  taskId: string;
  canEdit: boolean;
  /** Theme key to name, for giving a whole theme one owner. */
  themes: Record<string, string>;
  /** What the person running the audit is called here: "Certification body". */
  ledBy: string;
  /** Called after the records changed, with a line saying what happened. */
  onDone: (said: string) => void;
}): VNode | null {
  const [text, setText] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string) => (e: Event) => setVals((v) => ({ ...v, [k]: (e.target as HTMLInputElement).value }));

  useEffect(() => {
    setErr("");
    if (taskId === "scope.written" || taskId === "risk.method") {
      programme.get().then((p) => setText((taskId === "scope.written" ? p.scope : p.methodology) ?? "")).catch(() => {});
    }
    if (taskId === "setup.branding") organisation.get().then((n) => setVals({ org: n })).catch(() => {});
    if (taskId === "certify.body") setVals({ body: "", date: "" });
  }, [taskId]);

  if (!INLINE[taskId]) return null;
  if (!canEdit) return html`<p class="muted">Your role can read this but not change it.</p>`;

  const run = async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true); setErr("");
    try { onDone(await fn()); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const save = (label = "Save and next") => html`<button class="btn primary" disabled=${busy} onClick=${() => void submit()}>${busy ? "Saving…" : label}</button>`;

  async function submit(): Promise<void> {
    switch (taskId) {
      case "scope.written":
      case "risk.method":
        if (!text.trim()) { setErr("Write a sentence or two first."); return; }
        return run(async () => {
          await programme.update(taskId === "scope.written" ? { scope: text.trim() } : { methodology: text.trim() });
          return taskId === "scope.written" ? "Scope saved" : "Risk method saved";
        });
      case "setup.branding":
        if (!(vals["org"] ?? "").trim()) { setErr("Type your organisation's name first."); return; }
        return run(async () => { await organisation.set(vals["org"]!.trim()); return "Organisation name saved. Add your logo in Reports."; });
      case "soa.owners": {
        const chosen = Object.keys(themes).filter((k) => (vals[k] ?? "").trim());
        if (!chosen.length) { setErr("Type an owner for at least one area."); return; }
        return run(async () => {
          let n = 0;
          for (const k of chosen) n += (await readiness.bulk({ theme: k, owner: vals[k]!.trim() })).updated;
          return `${n} controls now have an owner`;
        });
      }
      case "certify.body":
        if (!(vals["body"] ?? "").trim() || !vals["date"]) { setErr(`Fill in the ${ledBy.toLowerCase()} and the date.`); return; }
        return run(async () => {
          // The next planned external audit if there is one, so a second booking
          // moves it rather than adding a twin.
          const open = (await reviews.list()).find((r) => r["kind"] === "External audit" && (r["status"] === "Planned" || r["status"] === "In progress"));
          const body = { title: `Certification audit, ${vals["date"]!.slice(0, 4)}`, kind: "External audit", status: "Planned",
            plannedDate: vals["date"], ledBy: vals["body"]!.trim() };
          if (open) await reviews.update(String(open.id), body);
          else await reviews.create(body);
          return `${vals["body"]!.trim()} booked for ${vals["date"]}. The Dashboard now counts down to it.`;
        });
    }
  }

  const body = (): VNode => {
    switch (taskId) {
      case "scope.written":
        return html`<textarea rows="4" value=${text} onInput=${(e: Event) => setText((e.target as HTMLTextAreaElement).value)}
          placeholder="The design, development and support of our customer portal, run from our Riyadh office and hosted on AWS. Payroll and HR systems run by our provider are outside the scope."></textarea>`;
      case "risk.method":
        return html`<textarea rows="4" value=${text} onInput=${(e: Event) => setText((e.target as HTMLTextAreaElement).value)}
          placeholder="Each risk is scored for likelihood and impact from 1 to 5. Anything scoring 12 or more is treated; owners can accept lower ones. Risks are reviewed every quarter and after any major change."></textarea>`;
      case "setup.branding":
        return html`<div class="sr-form"><label>Organisation name<input value=${vals["org"] ?? ""} onInput=${set("org")} /></label></div>`;
      case "soa.owners":
        return html`<table class="sr-table"><tbody>
          ${Object.entries(themes).map(([k, name]) => html`<tr key=${k}><td>${tidyTheme(name)}</td>
            <td><input placeholder="Owner's name" value=${vals[k] ?? ""} onInput=${set(k)} /></td></tr>`)}
        </tbody></table>`;
      case "certify.body":
        return html`<div class="sr-form">
          <label>${ledBy}<input value=${vals["body"] ?? ""} onInput=${set("body")} placeholder="Example Certification Ltd" /></label>
          <label>Audit date<input type="date" value=${vals["date"] ?? ""} onInput=${set("date")} /></label>
        </div>`;
      default:
        return html`<span></span>`;
    }
  };

  return html`<div class="sr-inline">
    ${body()}
    ${err ? html`<div class="err" role="alert" style="margin-top:8px">${err}</div>` : null}
    <div style="margin-top:10px">${save()}</div>
  </div>`;
}

// ── "If the auditor came today" ──────────────────────────────────────────────

const PILL: Record<LikelyFinding["label"], string> = { Fail: "red", Gap: "red", Partial: "amber", Stale: "amber" };

/** When this browser last ran a mock audit. Kept in the browser only: it is a nudge, not a record. */
const LAST_RUN_KEY = "offset.mockAudit.lastRun";
const DAY = 86_400_000;
function readLastRun(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_RUN_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function ago(t: number): string {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return `today at ${time}`;
  if (d.toDateString() === new Date(Date.now() - DAY).toDateString()) return `yesterday at ${time}`;
  const days = Math.round((Date.now() - t) / DAY);
  return `${days} days ago`;
}
const SHIELD = html`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`;
const CHECK = html`<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;

export function AuditorToday({ ready, canEdit, onRerun }: {
  ready: Readiness | null;
  canEdit: boolean;
  onRerun: () => Promise<void>;
}): VNode {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [before, setBefore] = useState<number | null>(null);
  const [panel, setPanel] = useState<LikelyFinding | null>(null);
  const [lastRun, setLastRun] = useState<number | null>(readLastRun);
  const [justRan, setJustRan] = useState(false);

  if (!ready) return html`<div class="card pad muted">Working out what an auditor would find…</div>`;
  const w = ready.words;
  const list = all ? ready.findings : ready.findings.slice(0, 4);
  const n = ready.findings.length;
  // The light sweep only when a mock audit is due: never run here, or not for a day.
  const due = lastRun === null || Date.now() - lastRun > DAY;

  const rerun = async (): Promise<void> => {
    setBefore(n);
    setRunning(true);
    setJustRan(false);
    const started = Date.now();
    try {
      await onRerun();
      // It answers in milliseconds; keep "Checking…" long enough to be seen.
      await new Promise((r) => setTimeout(r, Math.max(0, 700 - (Date.now() - started))));
      const now = Date.now();
      try { localStorage.setItem(LAST_RUN_KEY, String(now)); } catch { /* private mode: fine */ }
      setLastRun(now);
      setJustRan(true);
    } finally { setRunning(false); }
  };

  const result = justRan
    ? before === n
      ? `Checked just now · no change, still ${n} likely ${plural(n, w.finding, w.findings)}`
      : `Checked just now · ${n} likely ${plural(n, w.finding, w.findings)}, was ${before}`
    : lastRun === null
      ? "Run one after any change to see what an auditor would raise."
      : `Last run ${ago(lastRun)}.`;

  return html`<div class="card pad">
    <div class="ma-banner">
      <span class="ma-icon" aria-hidden="true">${SHIELD}</span>
      <span class="ma-text">
        <b>See what an ${w.auditorShort} would find, right now</b>
        <span class=${justRan ? "ma-done" : ""} role="status">A mock audit checks every control, document and piece of evidence. ${result}</span>
      </span>
      <button type="button" class=${`btn-raised${due && !running ? " sweep" : ""}`} disabled=${running} onClick=${() => void rerun()}>
        ${running ? html`<span class="ma-spin" aria-hidden="true"></span>` : CHECK}
        ${running ? "Checking your records…" : "Run a mock audit"}
      </button>
    </div>
    <div class="sr-lbl">If the ${w.auditorShort} came today</div>
    <div class="sr-big" style=${`color:${n ? "var(--red)" : "var(--ready-green)"}`}>${n}</div>
    <div class="muted" style="font-size:13px;margin-bottom:6px">likely ${plural(n, w.finding, w.findings)}${before !== null && before !== n ? `, was ${before}` : ""}</div>
    ${n === 0
      ? html`<p class="muted">Nothing an ${w.auditorShort} would obviously raise. Keep the evidence coming as each control runs.</p>`
      : html`<div class=${all ? "sr-scroll" : ""}>
          ${list.map((x) => html`<div key=${x.id}>
            <button type="button" class=${`sr-exc${open === x.id ? " sel" : ""}`} onClick=${() => setOpen(open === x.id ? null : x.id)}>
              <span><span class="sr-chev">${open === x.id ? "▾" : "▸"}</span><b>${x.ref}</b> · ${x.title}</span>
              <span class=${`pill ${PILL[x.label]}`}>${x.label}</span>
            </button>
            ${open === x.id
              ? html`<div class="sr-howto">
                  <p><b>What the ${w.auditorShort} will say:</b> ${x.says}</p>
                  <p><b>How to fix it:</b> ${x.fix}</p>
                  <div class="sr-actions">
                    <button class="btn small primary" onClick=${() => setPanel(x)}>${x.action.label}</button>
                  </div>
                </div>`
              : null}
          </div>`)}
        </div>`}
    ${n > 4
      ? html`<button type="button" class="linkish" style="margin-top:8px" onClick=${() => setAll((v) => !v)}>
          ${all ? "Show fewer" : `Show all ${n}`}</button>`
      : null}
    ${panel ? html`<${FixPanel} x=${panel} canEdit=${canEdit} finding=${w.finding} onClose=${() => setPanel(null)} onFixed=${async () => { setPanel(null); await rerun(); }} />` : null}
  </div>`;
}

/**
 * Where a finding is fixed. A failed test is retested right here; anything
 * else opens the screen where its records live.
 */
function FixPanel({ x, canEdit, finding, onClose, onFixed }: {
  x: LikelyFinding; canEdit: boolean; finding: string; onClose: () => void; onFixed: () => Promise<void>;
}): VNode {
  const [tester, setTester] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState("Pass");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const retest = Boolean(x.controlId) && canEdit;

  const record = async (): Promise<void> => {
    if (!note.trim()) { setErr("Say what you looked at, for example 'the 5 leavers in March'."); return; }
    setBusy(true); setErr("");
    try {
      await controlTests.add(x.controlId!, { testedOn: new Date().toISOString().slice(0, 10), tester: tester.trim(), result, note: note.trim() });
      await onFixed();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return html`<div class="sr-modal" onClick=${(e: Event) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="sr-modal-box" role="dialog" aria-modal="true">
      <div class="sr-lbl">Fix this ${finding}</div>
      <h3 style="margin:2px 0 10px"><b>${x.ref}</b> · ${x.title}</h3>
      <p class="muted" style="margin:0 0 12px">${x.fix}</p>
      ${retest
        ? html`<div class="sr-form">
            <label>Result<select value=${result} onChange=${(e: Event) => setResult((e.target as HTMLSelectElement).value)}>
              <option>Pass</option><option>Partial</option><option>Fail</option></select></label>
            <label>Tested by<input value=${tester} onInput=${(e: Event) => setTester((e.target as HTMLInputElement).value)} /></label>
            <label style="grid-column:1/-1">What you looked at<input value=${note} onInput=${(e: Event) => setNote((e.target as HTMLInputElement).value)} /></label>
          </div>`
        : html`<p>This is fixed on the <b>${x.action.route}</b> screen. When the records change, this list updates on its own.</p>`}
      ${err ? html`<div class="err" role="alert">${err}</div>` : null}
      <div class="sr-actions" style="justify-content:flex-end;margin-top:14px">
        <button class="btn" onClick=${onClose}>Cancel</button>
        ${retest
          ? html`<button class="btn primary" disabled=${busy} onClick=${() => void record()}>${busy ? "Saving…" : "Record the test"}</button>`
          : html`<button class="btn primary" onClick=${() => go(x.action.route)}>${x.action.label}</button>`}
      </div>
    </div>
  </div>`;
}

// ── fix first, quick wins, bulk ──────────────────────────────────────────────

export function QuickWins({ ready }: { ready: Readiness | null }): VNode | null {
  if (!ready) return null;
  if (!ready.quickWins.length) {
    return html`<div class="card pad"><div class="sr-lbl">Quick fixes</div>
      <p class="muted" style="margin:0">Nothing quick is waiting: every control has an owner, and policies, evidence and suppliers all have their dates.</p></div>`;
  }
  const mins = ready.quickWins.reduce((n, w) => n + Math.min(w.count, 10) * w.minutes, 0);
  return html`<div class="card pad">
    <div class="sr-lbl">Got ${mins <= 15 ? "15" : "30"} minutes?</div>
    <div class="sr-big" style="font-size:20px">${ready.quickWins.reduce((n, w) => n + w.count, 0)} quick fixes</div>
    ${ready.quickWins.map((w) => html`<div class="sr-qw" key=${w.id}>
      <span>${w.title}</span><span class="muted">${w.count} · about ${w.minutes} min each</span>
      <button class="btn small" onClick=${() => go(w.route)}>Do it</button>
    </div>`)}
  </div>`;
}
