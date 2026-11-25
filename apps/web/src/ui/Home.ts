import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { pickStep } from "./pickedStep.js";
import { journey as journeyApi, type Journey, type JourneyTask, type ReadinessDashboard, type ReadinessWords } from "../persistence/apiClient.js";
import { Ring, greeting, useCountUp } from "./motion.js";
import { Icon } from "./icons.js";

/**
 * The top of the Dashboard: one sentence on where you stand, the ring, and the
 * next three things to do, each one click from being done. Everything below it
 * is detail for when you want it. The shape is Offset Attest's.
 */

const longDay = (d: string): string =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", timeZone: "UTC" });

/** The three steps to show: the plan's suggestion first, then the next ones still to do, in order. */
function nextSteps(plan: Journey): { task: JourneyTask; stage: string; n: number }[] {
  const all = plan.stages.flatMap((s) => s.tasks.map((task) => ({ task, stage: s.name })));
  const open = all.filter((x) => x.task.state === "outstanding");
  const from = Math.max(0, open.findIndex((x) => x.task.id === plan.suggested));
  return open.slice(from).concat(open.slice(0, from)).slice(0, 3)
    .map((x) => ({ task: x.task, stage: x.stage, n: all.indexOf(x) + 1 }));
}

function Fact({ value, of, label, href, tone }: { value: number; of?: number; label: string; href: string; tone?: string }): VNode {
  const n = useCountUp(value);
  return html`
    <a class=${`hero-fact${tone ? ` ${tone}` : ""}`} href=${href}>
      <b>${n}${of !== undefined ? html`<small> / ${of}</small>` : null}</b>
      <span>${label}</span>
    </a>`;
}

export function HomeHero({ name, d, words, pct, ringLabel, gaps, journey }: {
  name: string;
  /** The flight path, where the pack has one. */
  d: ReadinessDashboard | null;
  words: ReadinessWords | undefined;
  pct: number;
  ringLabel: string;
  /** Items marked implemented that have nothing to prove it. */
  gaps: number | null;
  /** Whether the pack has the Plan. */
  journey: boolean;
}): VNode {
  const [plan, setPlan] = useState<Journey | null>(null);
  useEffect(() => {
    if (journey) journeyApi.get().then(setPlan).catch(() => setPlan(null));
  }, [journey]);

  const first = name.split(/\s+/)[0] ?? name;
  const keyDate = d?.keyDate ?? null;
  const what = words?.keyDate ?? "audit";
  const steps = plan ? nextSteps(plan) : [];

  const headline = pct >= 100
    ? html`Every item in scope is in place. <span>Now keep the proof current.</span>`
    : pct === 0
    ? html`Let's get you started on your <em>${what}</em>.`
    : html`You're <em>${pct}%</em> ready for your ${what}.`;

  const line = !d
    ? "Work through the plan, and keep the proof current."
    : !keyDate
    ? `Add your ${what} to Audits and reviews, and this shows how many days you have.`
    : keyDate.daysTo < 0
    ? `Your ${what} was ${-keyDate.daysTo} day${keyDate.daysTo === -1 ? "" : "s"} ago.`
    : `${keyDate.daysTo} day${keyDate.daysTo === 1 ? "" : "s"} to your ${what}${d.projectedReady ? `; at this pace you're ready by ${longDay(d.projectedReady)}` : ""}.`;

  return html`
    <section class="hero card">
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="hero-main">
        <div class="hero-eyebrow">${greeting()}, ${first} · ${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</div>
        <h2 class="hero-title">${headline}</h2>
        <p class="hero-line">${line}${d && d.weekChange > 0 ? html` <span class="hero-up">+${d.weekChange} points this week</span>` : null}</p>
        <div class="hero-actions">
          ${steps[0]
            ? html`<a class="btn primary" href="#/getready">Continue: ${steps[0].task.title}<${Icon} name="arrow" /></a>`
            : html`<a class="btn primary" href="#/getready">Open Plan<${Icon} name="arrow" /></a>`}
          <a class="btn" href="#/auditor">Auditor view</a>
        </div>
      </div>
      <div class="hero-side">
        <${Ring} pct=${pct} size=${148} stroke=${12} label=${ringLabel} />
        <div class="hero-facts">
          ${plan ? html`<${Fact} value=${plan.done} of=${plan.applicable} label="plan steps done" href="#/getready" />` : null}
          ${d ? html`<${Fact} value=${d.lens.findings} label=${d.lens.findings === 1 ? `would raise a ${words?.finding ?? "finding"}` : `would raise ${words?.findings ?? "findings"}`} href="#/getready" tone=${d.lens.findings ? "warn" : "ok"} />` : null}
          ${gaps !== null ? html`<${Fact} value=${gaps} label=${gaps === 1 ? "evidence gap" : "evidence gaps"} href="#/evidence" tone=${gaps ? "warn" : "ok"} />` : null}
        </div>
      </div>
    </section>
    ${steps.length
      ? html`<section class="upnext">
          <div class="upnext-h"><h2>Up next</h2><a href="#/getready">The whole plan<${Icon} name="chev" /></a></div>
          <div class="upnext-grid">
            ${steps.map((s, i) => html`
              <button type="button" class=${`upnext-card${i === 0 ? " first" : ""}`} key=${s.task.id} onClick=${() => { pickStep(s.task.id); window.location.hash = "#/getready"; }}>
                <span class="upnext-n">${i === 0 ? "Next" : `Step ${s.n}`}<i>${s.stage}</i></span>
                <b>${s.task.title}</b>
                <span class="upnext-why">${s.task.why || s.task.do}</span>
                <span class="upnext-go">${i === 0 ? "Start" : "Open"}<${Icon} name="arrow" /></span>
              </button>`)}
          </div>
        </section>`
      : null}`;
}
