import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import {
  journey as api,
  templates,
  type PackTemplate,
  type Journey,
  type JourneyAssignment,
  type JourneyStage,
  type JourneyTask,
  type TaskState,
} from "../persistence/apiClient.js";
import { ThreadSummary } from "./GoldenThread.js";

/**
 * The readiness plan: what to do, in what order, and how far along they are.
 *
 * Built for a customer with no security team and no auditor. Every task says
 * what to do and why in plain words, and links to the screen where it is done,
 * because "improve your governance" is advice and "open People and add your
 * colleagues" is an instruction.
 *
 * Nothing is locked. The order is what most organisations find easiest, not a
 * rule, and software that refuses to let somebody write their policies before
 * finishing an assessment is software they stop opening.
 */

const GREEN = "#16a34a";
const AMBER = "#d97706";
const GREY = "#94a3b8";
const SLATE = "#cbd5e1";

const stageColour = (s: JourneyStage, suggested: boolean): string =>
  s.complete ? GREEN : s.done > 0 || suggested ? AMBER : GREY;

/**
 * Breaks a stage name over at most three lines.
 *
 * SVG text does not wrap, and truncating gave "Decide what you are…", which
 * tells a reader nothing about the stage they are being asked to click. Short
 * lines fit the space and keep every word.
 */
function wrap(name: string, width = 17): string[] {
  const words = name.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= width || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);

  // Anything longer than three lines is squeezed into the third one; the full
  // name is in the tooltip and in the heading below either way.
  return lines.length <= 3 ? lines : [lines[0]!, lines[1]!, lines.slice(2).join(" ")];
}

/**
 * The stages as a row of rings.
 *
 * Each ring fills as its steps get done, so how far a stage has got reads at
 * a glance instead of from a "1 of 4" in small print. A finished stage turns
 * solid green with a tick. Drawn rather than pulled from a library for the
 * same reason as the other charts: it is a handful of circles, and it prints.
 */
function stageFlow(
  stages: JourneyStage[],
  suggested: string | null,
  selected: string,
  onPick: (id: string) => void,
): VNode {
  const n = stages.length;
  const W = 1000;
  const gap = W / n;
  const cx = (i: number): number => gap * i + gap / 2;
  const cy = 30;
  const R = 19;
  const C = 2 * Math.PI * R;

  // As many characters as each stage's space holds, at about 7.2 units a
  // character at this size, so "Statement of Applicability" never runs into
  // its neighbour.
  const perLine = Math.min(18, Math.floor((gap - 10) / 7.2));
  const labels = stages.map((s) => wrap(s.name, perLine));
  const rows = Math.max(...labels.map((l) => l.length));
  const top = cy + R + 19;
  const countY = top + rows * 16 + 2;
  const H = countY + 10;

  return html`
    <svg viewBox=${`0 0 ${W} ${H}`} class="stage-flow" role="img"
         aria-label="The stages of the readiness plan and how far each one has got">
      ${stages.slice(0, -1).map((s, i) => html`<line
          x1=${cx(i) + R + 8} y1=${cy} x2=${cx(i + 1) - R - 8} y2=${cy}
          stroke=${s.complete ? GREEN : SLATE} stroke-width="2"
          stroke-dasharray=${s.complete ? "" : "4 5"} />`)}

      ${stages.map((s, i) => {
        const frac = s.applicable === 0 ? 1 : s.done / s.applicable;
        const colour = s.complete ? GREEN : frac > 0 ? AMBER : GREY;
        const isSelected = s.id === selected;
        const isNext = s.id === suggested;
        return html`<g class="stage-node" role="button" tabindex="0"
          onClick=${() => onPick(s.id)}
          onKeyDown=${(e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onPick(s.id);
            }
          }}>
          <title>${s.name}: ${s.done} of ${s.applicable} done</title>
          ${isSelected
            ? html`<circle cx=${cx(i)} cy=${cy} r=${R + 7} fill="none" stroke="#2457D6" stroke-width="2" opacity="0.35" />`
            : null}
          <circle cx=${cx(i)} cy=${cy} r=${R} fill=${s.complete ? GREEN : "#fff"} stroke="#e6eaf2" stroke-width="5" />
          ${!s.complete && frac > 0
            ? html`<circle cx=${cx(i)} cy=${cy} r=${R} fill="none" stroke=${colour} stroke-width="5"
                     stroke-linecap="round" stroke-dasharray=${`${C * frac} ${C}`}
                     transform=${`rotate(-90 ${cx(i)} ${cy})`} />`
            : null}
          ${s.complete
            ? html`<path d=${`M ${cx(i) - 7} ${cy} l 5 6 l 10 -12`} fill="none"
                     stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`
            : html`<text x=${cx(i)} y=${cy + 5} text-anchor="middle" font-size="14" font-weight="700"
                     fill=${frac > 0 ? AMBER : "#64748b"}>${i + 1}</text>`}
          ${labels[i]!.map(
            (line, row) => html`<text x=${cx(i)} y=${top + row * 16} text-anchor="middle"
                  font-size="13.5" font-weight=${isSelected ? "700" : "600"}
                  fill=${isSelected ? "#2457D6" : "#0B1220"}>${line}</text>`,
          )}
          <text x=${cx(i)} y=${countY} text-anchor="middle" font-size="12"
                fill=${isNext && !s.complete ? "#2457D6" : "#64748b"}
                font-weight=${isNext && !s.complete ? "700" : "400"}>
            ${s.applicable === 0 ? "nothing to do" : s.complete ? "done" : `${s.done} of ${s.applicable}${isNext ? " · next" : ""}`}
          </text>
        </g>`;
      })}
    </svg>`;
}

/** The chip on a task, and on a stage heading. */
function chip(state: TaskState, automatic: boolean): VNode {
  if (state === "done") {
    return html`<span class="jt-chip done">
      ${automatic ? "Done · checked for you" : "Done"}
    </span>`;
  }
  if (state === "not_applicable") return html`<span class="jt-chip na">Does not apply</span>`;
  return html`<span class="jt-chip todo">${automatic ? "Not yet" : "To do"}</span>`;
}

function Task({
  task,
  canEdit,
  busy,
  onSet,
  featured = false,
  tpl,
}: {
  task: JourneyTask;
  canEdit: boolean;
  busy: boolean;
  /** The one step at the top of the screen: bigger, and without the outline. */
  featured?: boolean;
  /** The template that gives this step a start, looked up from the pack's index. */
  tpl?: PackTemplate;
  onSet: (state: TaskState, reason?: string, assign?: JourneyAssignment) => void;
}): VNode {
  const [excluding, setExcluding] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [reason, setReason] = useState(task.reason);
  const [who, setWho] = useState({
    owner: task.owner,
    ownerEmail: task.ownerEmail,
    dueDate: task.dueDate ?? "",
  });

  const done = task.state === "done";
  const na = task.state === "not_applicable";

  return html`
    <div class=${`jt ${task.state}${featured ? " featured" : ""}`}>
      <div class="jt-head">
        <div class="jt-title">
          ${task.title}
          ${task.clause
            ? html`<span class="jt-clause" title="The clause this step satisfies">${task.clause}</span>`
            : null}
        </div>
        ${chip(task.state, task.automatic)}
      </div>

      <p class="jt-do">${task.do}</p>
      <p class="jt-why muted"><b>Why it matters.</b> ${task.why}</p>

      ${tpl
        ? html`<div class="jt-template">
            <div>
              <b>This is a document in Policies.</b> Start from the template${" "}
              <b>${tpl.title}</b>: it is already written, with highlighted places for your own details.
            </div>
            <a class="btn small" href="#/policies/templates">Open the template</a>
          </div>`
        : null}

      ${task.detail ? html`<div class="jt-detail muted">${task.detail}</div>` : null}
      ${na && task.reason
        ? html`<div class="jt-detail muted">Excluded: ${task.reason}</div>`
        : null}

      ${task.owner || task.dueDate
        ? html`<div class="jt-detail muted">
            ${task.owner || "Unassigned"}${task.dueDate ? ` · due ${task.dueDate}` : ""}
            ${task.dueDate && !task.ownerEmail ? " · no email, so nobody is chased" : ""}
          </div>`
        : null}

      <div class="jt-actions">
        ${task.goto
          ? html`<a class="btn small" href=${`#/${task.goto}`}>Take me there</a>`
          : null}

        ${!canEdit
          ? null
          : task.automatic && !na
            ? html`<span class="muted jt-auto">
                The product checks this one itself — nothing to tick.
              </span>`
            : html`<button class="btn small" disabled=${busy}
                     onClick=${() => onSet(done ? "outstanding" : "done")}>
                ${done ? "Undo" : "Mark done"}
              </button>`}

        ${canEdit && !na
          ? html`<button class="btn small" disabled=${busy}
                   onClick=${() => setAssigning((v) => !v)}>
              ${task.owner || task.dueDate ? "Change who and when" : "Assign it"}
            </button>`
          : null}

        ${canEdit && !na
          ? html`<button class="btn small ghost" disabled=${busy}
                   onClick=${() => { setReason(""); setExcluding(true); }}>
              Does not apply to us
            </button>`
          : null}

        ${canEdit && na
          ? html`<button class="btn small ghost" disabled=${busy}
                   onClick=${() => onSet("outstanding")}>
              Put it back
            </button>`
          : null}
      </div>

      ${assigning
        ? html`<div class="confirm">
            <div><b>Who is doing this, and by when?</b></div>
            <p class="muted" style="margin:6px 0 8px">
              With both a date and an address, they get an email three days before,
              again on the day, and then while it stays outstanding. Leave the
              address blank and nobody is chased.
            </p>
            <div class="jt-assign">
              <input placeholder="Name" value=${who.owner}
                onInput=${(e: Event) =>
                  setWho({ ...who, owner: (e.target as HTMLInputElement).value })} />
              <input type="email" placeholder="name@yourcompany.com" value=${who.ownerEmail}
                onInput=${(e: Event) =>
                  setWho({ ...who, ownerEmail: (e.target as HTMLInputElement).value })} />
              <input type="date" value=${who.dueDate}
                onInput=${(e: Event) =>
                  setWho({ ...who, dueDate: (e.target as HTMLInputElement).value })} />
            </div>
            <div class="confirm-actions">
              <button class="btn small" onClick=${() => setAssigning(false)}>Cancel</button>
              <button class="btn small primary" disabled=${busy}
                onClick=${() => {
                  // Keeps whatever state the step is already in; this only
                  // changes who owns it.
                  onSet(task.state === "done" ? "done" : "outstanding", "", {
                    owner: who.owner.trim(),
                    ownerEmail: who.ownerEmail.trim(),
                    dueDate: who.dueDate === "" ? null : who.dueDate,
                  });
                  setAssigning(false);
                }}>
                Save
              </button>
            </div>
          </div>`
        : null}

      ${excluding
        ? html`<div class="confirm">
            <div><b>Why does this not apply to you?</b></div>
            <p class="muted" style="margin:6px 0 8px">
              This is the one place you can take work off your own plan, so write
              something an assessor would accept. "We have no payment systems" is a
              reason. "We have not got round to it" is not — that one is just
              outstanding.
            </p>
            <textarea rows="2" value=${reason}
              onInput=${(e: Event) => setReason((e.target as HTMLTextAreaElement).value)}
            ></textarea>
            <div class="confirm-actions">
              <button class="btn small" onClick=${() => setExcluding(false)}>Cancel</button>
              <button class="btn small primary" disabled=${!reason.trim() || busy}
                onClick=${() => { onSet("not_applicable", reason.trim()); setExcluding(false); }}>
                Exclude it
              </button>
            </div>
          </div>`
        : null}
    </div>`;
}

export function Journey({ canEdit, itemLabel }: { canEdit: boolean; itemLabel: string }): VNode {
  const [plan, setPlan] = useState<Journey | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** Empty until the plan loads, then the stage we suggest they start on. */
  const [open, setOpen] = useState("");
  /**
   * One stage at a time, or the whole plan at once.
   *
   * One stage is the right default: somebody who does not know where to start
   * is not helped by twenty-four steps at once. But a reader who wants the plan
   * end to end, or who wants to print the page, needs it all in one place, and
   * sending them to the PDF for that would be a silly answer.
   */
  const [showAll, setShowAll] = useState(false);
  /** The pack's long introduction, behind a link, so the plan itself comes first. */
  const [how, setHow] = useState(false);
  /** Template titles by file name, so a step can say which one to start from. */
  const [tpls, setTpls] = useState<Record<string, PackTemplate>>({});
  useEffect(() => {
    let live = true;
    templates.index()
      .then((d) => live && setTpls(Object.fromEntries(d.documents.map((t) => [t.file, t]))))
      .catch(() => { /* packs without templates 404 here, and need no link */ });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    api
      .get()
      .then((j) => {
        if (!live) return;
        setPlan(j);
        setOpen((cur) => cur || j.suggested || j.stages[0]?.id || "");
      })
      .catch((err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  async function set(
    taskId: string,
    state: TaskState,
    reason = "",
    assign: JourneyAssignment = {},
  ): Promise<void> {
    setBusy(true);
    setError("");
    try {
      // The server returns the whole plan, so one tick can move a stage from
      // amber to green without the screen having to work that out itself.
      setPlan(await api.set(taskId, state, reason, assign));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !plan) return html`<div class="card pad error-box">${error}</div>`;
  if (!plan) return html`<div class="card pad muted">Loading…</div>`;

  const stage = plan.stages.find((s) => s.id === open) ?? plan.stages[0]!;
  const left = plan.applicable - plan.done;

  /**
   * The next step: the first one not done, in the order of the plan.
   *
   * The answer to the only question somebody opening this screen really has,
   * "what do I do now?", put where they cannot miss it. A suggestion, like the
   * order itself; nothing is locked.
   */
  const outstanding = plan.stages.flatMap((s, si) =>
    s.tasks.filter((t) => t.state === "outstanding").map((t) => ({ t, s, si })));
  const next = outstanding[0];
  const after = outstanding.slice(1, 3);

  /**
   * Nearly there: automatic checks that are most of the way to passing, such
   * as "91 of 92 that apply have an owner". Each is usually one or two fixes,
   * and finishing things is what keeps people going.
   */
  const wins = outstanding
    .filter((x) => x.t.automatic && x !== next)
    .map((x) => {
      const m = /(\d+) of (\d+)/.exec(x.t.detail);
      if (!m) return null;
      const got = Number(m[1]), of = Number(m[2]);
      return of > 0 && got < of && got / of >= 0.75 ? { ...x, gap: of - got } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((p, q) => p.gap - q.gap)
    .slice(0, 3);

  return html`<>
    ${error ? html`<div class="card pad error-box" style="margin-bottom:14px">${error}</div>` : null}

    <div class="card pad">
      <div class="journey-head">
        <div>
          <h2 style="margin:0">${plan.title}</h2>
          <p class="muted" style="margin:6px 0 0;max-width:none">
            ${plan.stages.length} stages, in the order most organisations find easiest. Do them in any order.
            ${" "}<button class="linkish" aria-expanded=${how} onClick=${() => setHow((v) => !v)}>
              ${how ? "Hide how this works" : "How this works"}
            </button>
          </p>
          ${how ? html`<p class="muted journey-how">${plan.intro}</p>` : null}
        </div>
        <div class="journey-score">
          <div class="journey-pct" style=${`color:${plan.pct === 100 ? GREEN : AMBER}`}>
            ${plan.pct}%
          </div>
          <div class="muted">
            ${plan.done} of ${plan.applicable} done${left ? ` · ${left} to go` : ""}
          </div>
        </div>
      </div>

      ${stageFlow(plan.stages, plan.suggested, stage.id, setOpen)}

      <div class="journey-foot">
        <button class="btn small" onClick=${() => setShowAll((v) => !v)}>
          ${showAll ? "Show one stage at a time" : "Read the whole plan"}
        </button>
      </div>
    </div>

    ${next
      ? html`<div class="card pad next-step">
          <div class="next-eyebrow">
            Your next step · Stage ${next.si + 1}, ${next.s.name}
          </div>
          <${Task} key=${next.t.id} task=${next.t} canEdit=${canEdit} busy=${busy} featured tpl=${next.t.template ? tpls[next.t.template] : undefined}
                   onSet=${(state: TaskState, reason?: string, assign?: JourneyAssignment) =>
                     void set(next.t.id, state, reason, assign)} />
          ${after.length
            ? html`<div class="next-after muted">
                After that:${" "}
                ${after.map((x, i) => html`${i ? ", then " : ""}<button class="linkish"
                    onClick=${() => { setShowAll(false); setOpen(x.s.id); }}>${x.t.title}</button>`)}
              </div>`
            : null}
        </div>`
      : html`<div class="card pad next-step done">
          <div class="next-eyebrow">Every step is done or ruled out</div>
          <p style="margin:6px 0 0">The plan is finished. What matters now is keeping the proof current, so it still shows everything working on the day of the audit.</p>
        </div>`}

    <div class="journey-extras">
      ${wins.length
        ? html`<div class="card pad wins">
            <div class="wins-head">Nearly there</div>
            <p class="muted" style="margin:2px 0 6px">Checks that are almost passing. Usually one or two fixes each.</p>
            ${wins.map((x) => html`<div class="win">
                <div style="min-width:0">
                  <div class="win-title">${x.t.title}</div>
                  <div class="muted win-detail">${x.t.detail} · Stage ${x.si + 1}</div>
                </div>
                ${x.t.goto
                  ? html`<a class="btn small" href=${`#/${x.t.goto}`}>Fix it</a>`
                  : html`<button class="btn small" onClick=${() => { setShowAll(false); setOpen(x.s.id); }}>Open</button>`}
              </div>`)}
          </div>`
        : null}
      <${ThreadSummary} itemLabel=${itemLabel} />
    </div>

    ${(showAll ? plan.stages : [stage]).map(
      (st) => html`
        <div class="card pad" style="margin-top:16px" key=${st.id}>
          <div class="section-title">
            <h2>
              ${plan.stages.indexOf(st) + 1}. ${st.name}
              ${st.complete
                ? html`<span class="jt-chip done" style="margin-left:8px">Stage complete</span>`
                : st.id === plan.suggested
                  ? html`<span class="jt-chip todo" style="margin-left:8px">Suggested next</span>`
                  : null}
            </h2>
            <div class="muted">${st.done} of ${st.applicable} done</div>
          </div>
          <p class="muted" style="margin:0 0 14px;max-width:none">${st.aim}</p>

          <div class="jt-list">
            ${st.tasks.map(
              (t) => html`<${Task} key=${t.id} task=${t} canEdit=${canEdit} busy=${busy} tpl=${t.template ? tpls[t.template] : undefined}
                            onSet=${(state: TaskState, reason?: string, assign?: JourneyAssignment) =>
                              void set(t.id, state, reason, assign)} />`,
            )}
          </div>
        </div>`,
    )}

    ${showAll
      ? null
      : html`<div class="card pad" style="margin-top:16px">
          <div class="stage-nav" style="border-top:none;padding-top:0;margin-top:0">
            ${plan.stages.map(
              (s, i) => html`<button
                class=${`btn small ${s.id === stage.id ? "primary" : ""}`}
                onClick=${() => setOpen(s.id)}>
                ${i + 1}. ${s.name}
              </button>`,
            )}
          </div>
        </div>`}
  </>`;
}
