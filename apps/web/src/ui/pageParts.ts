import type { ComponentChildren, VNode } from "preact";
import { html } from "./html.js";

/** One slice of a summary bar: what it counts, how many, its tone, and what clicking it shows. */
export interface Slice {
  label: string;
  value: number;
  tone: "good" | "warn" | "bad" | "crit" | "info" | "none" | "mute";
  /** Selected: the list below is showing only this slice. */
  on?: boolean;
  onPick?: () => void;
  /** Kept out of the bar (for example, out of scope), but listed as a key. */
  outside?: boolean;
}

/**
 * The top of a working screen: one sentence on where it stands, a bar of the
 * parts that make it up, and keys that filter the list below. The same shape
 * on every screen, so people learn it once.
 */
export function SummaryBand({ lead, slices, aside, note }: {
  lead: ComponentChildren;
  slices: Slice[];
  aside?: ComponentChildren;
  note?: ComponentChildren;
}): VNode {
  const inBar = slices.filter((s) => !s.outside && s.value > 0);
  const total = inBar.reduce((a, s) => a + s.value, 0);
  return html`
    <section class="sum-band card">
      <div class="sum-top">
        <div class="sum-lead">${lead}</div>
        ${aside ? html`<div class="sum-aside">${aside}</div>` : null}
      </div>
      ${total
        ? html`<div class="sum-bar" role="img" aria-label=${inBar.map((s) => `${s.label} ${s.value}`).join(", ")}>
            ${inBar.map((s) => html`<span key=${s.label} data-tone=${s.tone} style=${`flex:${s.value}`} title=${`${s.label}: ${s.value}`}></span>`)}
          </div>`
        : null}
      <div class="sum-keys">
        ${slices.map((s) => s.onPick
          ? html`<button type="button" key=${s.label} class=${s.on ? "on" : ""} aria-pressed=${Boolean(s.on)} data-tone=${s.tone}
                     onClick=${s.onPick}><i aria-hidden="true"></i>${s.label}<b>${s.value}</b></button>`
          : html`<span key=${s.label} data-tone=${s.tone}><i aria-hidden="true"></i>${s.label}<b>${s.value}</b></span>`)}
        ${note ? html`<span class="sum-note">${note}</span>` : null}
      </div>
    </section>`;
}
