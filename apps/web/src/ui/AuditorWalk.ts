import type { VNode } from "preact";
import { html } from "./html.js";

/**
 * Walking an auditor through the steps of the Auditor view.
 *
 * A step opened from the Auditor view starts a walk-through: every screen then
 * carries a bar back to the Auditor view, with the previous and next step, so
 * the person showing it never has to find the menu with the auditor watching.
 * Kept for the browser tab only, so a new tab or a sign-out starts afresh.
 */

export interface WalkStep { title: string; route: string }
interface Walk { at: number; steps: WalkStep[] }

const KEY = "assure.auditorWalk";

export function readWalk(): Walk | null {
  try {
    const w = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Walk | null;
    return w && Array.isArray(w.steps) && w.steps.length && w.at >= 0 && w.at < w.steps.length ? w : null;
  } catch {
    return null;
  }
}

/** Opens one step, remembering the whole walk so the bar can go back and on. */
export function walkTo(steps: WalkStep[], at: number): void {
  const step = steps[at];
  if (!step) return;
  try { sessionStorage.setItem(KEY, JSON.stringify({ at, steps })); } catch { /* the bar just will not show */ }
  window.location.hash = `#/${step.route}`;
}

export function endWalk(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing kept */ }
}

/** The bar at the top of every screen while a walk-through is on. */
export function WalkBar({ onEnd }: { onEnd: () => void }): VNode | null {
  const w = readWalk();
  if (!w) return null;
  const step = w.steps[w.at]!;
  const next = w.steps[w.at + 1];
  return html`<div class="walk" role="navigation" aria-label="Auditor walk-through">
    <a class="walk-back" href="#/auditor">← Back to the Auditor view</a>
    <span class="walk-where"><b>Step ${w.at + 1} of ${w.steps.length} · ${step.title}</b>
      <small>${next ? `Next: ${next.title}` : "Last step"}</small></span>
    <span class="walk-dots" aria-hidden="true">${w.steps.map((_, i) => html`<i key=${i} class=${i === w.at ? "on" : i < w.at ? "done" : ""}></i>`)}</span>
    <button type="button" class="walk-nav" disabled=${w.at === 0} onClick=${() => walkTo(w.steps, w.at - 1)}>← Previous</button>
    <button type="button" class="walk-nav" disabled=${!next} onClick=${() => walkTo(w.steps, w.at + 1)}>Next step →</button>
    <button type="button" class="walk-end" onClick=${() => { endWalk(); onEnd(); }}>Return to standard view</button>
  </div>`;
}
