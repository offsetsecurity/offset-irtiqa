import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import {
  controlTests, organisation, programme, readiness, reviews,
  type Journey, type JourneyTask, type LikelyFinding, type Readiness,
} from "../persistence/apiClient.js";

/**
 * The readiness parts of Get ready: the progress panel, the in-card actions
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

// ── the strip and the progress panel ─────────────────────────────────────────

export function ReadyStrip({ plan, ready }: { plan: Journey; ready: Readiness | null }): VNode {
  const k = ready?.keyDate;
  const w = ready?.words;
  return html`<div class="sr-strip">
    <span><b>${plan.pct}% ready</b>
      ${w ? k
        ? k.daysTo >= 0 ? ` · ${k.daysTo} ${plural(k.daysTo, "day")} to your ${w.keyDate}` : ` · your ${w.keyDate} was ${-k.daysTo} ${plural(-k.daysTo, "day")} ago`
        : ` · no ${w.keyDate} booked yet` : ""}
      ${ready && w ? ` · ${ready.findings.length} likely ${plural(ready.findings.length, w.finding, w.findings)}` : ""}</span>
    <a href="#/dashboard">View dashboard →</a>
  </div>`;
}

export function ProgressPanel({ plan, current, onPick, snoozed }: {
  plan: Journey;
  current: JourneyTask | undefined;
  onPick: (taskId: string) => void;
  snoozed: Set<string>;
}): VNode {
  const [open, setOpen] = useState(false);
  const stageOf = plan.stages.find((s) => s.tasks.some((t) => t.id === current?.id)) ?? plan.stages.find((s) => !s.complete) ?? plan.stages[0]!;
  const si = plan.stages.indexOf(stageOf);
  const left = plan.applicable - plan.done;
  const icon = (t: JourneyTask): [string, string, string] =>
    t.state === "done" ? ["d", "✓", "Done"]
      : t.state === "not_applicable" ? ["n", "–", "Does not apply"]
      : t.id === current?.id ? ["c", "▶", "Next"]
      : snoozed.has(t.id) ? ["s", "↻", "Tomorrow"]
      : ["t", "", t.automatic ? "Checked for you" : "To do"];

  return html`<div class="card pad sr-plan">
    <div class="sr-planhead">
      <div>
        <div class="sr-lbl">${plan.title}</div>
        <div class="muted" style="font-size:13px"><b style="color:var(--ink)">${plan.done} of ${plan.applicable} steps done</b>
          ${" "}· you are on <b style="color:var(--brand)">stage ${si + 1} of ${plan.stages.length}, ${stageOf.name}</b></div>
      </div>
      <div style="text-align:right">
        <div class="sr-big" style="color:var(--ready-green)">${plan.pct}%</div>
        <div class="muted" style="font-size:12px">${left ? `${left} ${plural(left, "step")} to go` : "all done"}</div>
      </div>
    </div>
    <div class="sr-stepper" style=${`grid-template-columns:repeat(${plan.stages.length},1fr)`}>
      ${plan.stages.map((s, i) => {
        const first = s.tasks.find((t) => t.state === "outstanding") ?? s.tasks[0];
        return html`<button type="button" key=${s.id} class=${`sr-stp${s.complete ? " done" : ""}${i === si ? " now" : ""}`}
            title=${s.name} onClick=${() => first && onPick(first.id)}>
          <span class="sr-dot">${s.complete ? "✓" : i + 1}</span>
          <span>${SHORT[s.id] ?? s.name}</span>
          <span class="sr-bar"><i style=${`width:${s.pct}%`}></i></span>
          <span class="sr-of">${s.done} of ${s.applicable}</span>
        </button>`;
      })}
    </div>
    <div class="sr-planfoot">
      <span class="muted">This stage: ${stageOf.done} of ${stageOf.applicable} done${snoozed.size ? ` · ${snoozed.size} put off until tomorrow` : ""}</span>
      <button type="button" class=${`sr-planbtn${open ? " open" : ""}`} aria-expanded=${open} onClick=${() => setOpen((v) => !v)}>
        <span>${open ? "Hide the plan" : "See the whole plan"}</span>
        <span class="sr-planbtn-n">${plan.stages.reduce((n, s) => n + s.tasks.length, 0)} steps</span>
        <span class="sr-chevron" aria-hidden="true">▾</span>
      </button>
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

  if (!ready) return html`<div class="card pad muted">Working out what an auditor would find…</div>`;
  const w = ready.words;
  const list = all ? ready.findings : ready.findings.slice(0, 4);
  const n = ready.findings.length;

  const rerun = async (): Promise<void> => {
    setBefore(n);
    setRunning(true);
    try { await onRerun(); } finally { setRunning(false); }
  };

  return html`<div class="card pad">
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
    <div class="muted" style="font-size:12px;margin-top:8px">Last checked ${new Date(ready.ranAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
    <button class="btn" style="margin-top:10px" disabled=${running} onClick=${() => void rerun()}>${running ? "Checking your records…" : "Run a mock audit"}</button>
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

export function FixFirst({ ready }: { ready: Readiness | null }): VNode | null {
  if (!ready || !ready.fixFirst.length) return null;
  const removed = ready.fixFirst.reduce((n, x) => n + x.weight, 0);
  const all = ready.findings.reduce((n, x) => n + x.weight, 0);
  return html`<div class="card pad">
    <div class="sr-lbl">Fix these first · ranked by what they clear</div>
    ${ready.fixFirst.map((x) => html`<div class="sr-fix" key=${x.id}>
      <span class="sr-n">−${x.weight}</span>
      <span><b>${x.title}</b><br /><span class="muted">${x.ref} · ${x.fix}</span></span>
      <button class="btn small" onClick=${() => go(x.action.route)}>${x.action.label}</button>
    </div>`)}
    <p class="muted" style="font-size:12px;margin:10px 0 0">${ready.fixFirst.length === 1 ? "This clears" : `These ${ready.fixFirst.length} clear`} ${removed} of the ${all} gaps an ${ready.words.auditorShort} would find today.</p>
  </div>`;
}

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

export function BulkActions({ themes, canEdit, allowOut, onDone }: {
  themes: Record<string, string>;
  canEdit: boolean;
  /** Whether a whole theme may be taken out of scope, as a Statement of Applicability allows. */
  allowOut: boolean;
  onDone: (said: string) => void;
}): VNode | null {
  const keys = Object.keys(themes);
  const [ownerTheme, setOwnerTheme] = useState(keys[0] ?? "");
  const [owner, setOwner] = useState("");
  const [outTheme, setOutTheme] = useState(keys.includes("A7") ? "A7" : keys[keys.length - 1] ?? "");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  if (!canEdit || !keys.length) return null;

  const apply = async (body: { theme: string; owner?: string; outOfScope?: string }, said: (n: number) => string): Promise<void> => {
    setErr("");
    try { onDone(said((await readiness.bulk(body)).updated)); } catch (e) { setErr((e as Error).message); }
  };
  const pick = (val: string, on: (v: string) => void) => html`<select value=${val} onChange=${(e: Event) => on((e.target as HTMLSelectElement).value)}>
    ${keys.map((k) => html`<option value=${k} key=${k}>${tidyTheme(themes[k] ?? k)}</option>`)}</select>`;

  return html`<div class="card pad" style="margin-top:16px">
    <div class="sr-lbl">Do it in bulk</div>
    <div class="sr-blk"><span>Give every control in</span>${pick(ownerTheme, setOwnerTheme)}<span>the owner</span>
      <input value=${owner} placeholder="Owner's name" onInput=${(e: Event) => setOwner((e.target as HTMLInputElement).value)} />
      <button class="btn" onClick=${() => owner.trim() ? void apply({ theme: ownerTheme, owner: owner.trim() }, (n) => `${n} controls in ${tidyTheme(themes[ownerTheme] ?? ownerTheme)} now owned by ${owner.trim()}`) : setErr("Type the owner's name.")}>Apply</button></div>
    ${allowOut
      ? html`<div class="sr-blk"><span>Mark out of scope</span>${pick(outTheme, setOutTheme)}<span>because</span>
          <input value=${reason} placeholder="For example: we have no offices, everyone works remotely" onInput=${(e: Event) => setReason((e.target as HTMLInputElement).value)} />
          <button class="btn" onClick=${() => reason.trim() ? void apply({ theme: outTheme, outOfScope: reason.trim() }, (n) => `${n} controls in ${tidyTheme(themes[outTheme] ?? outTheme)} marked out of scope`) : setErr("Say why it is out of scope.")}>Apply</button></div>`
      : null}
    ${err ? html`<div class="err" role="alert" style="margin-top:8px">${err}</div>` : null}
  </div>`;
}
