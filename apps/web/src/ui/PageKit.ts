import type { VNode } from "preact";
import { html } from "./html.js";

/**
 * "Showing: Status: Not started ×  Theme: A.5 ×   Clear all".
 *
 * The strip of numbers that filter the list is Attest's `SummaryBand`
 * (pageParts.ts). This is the small thing it does not have: saying which
 * filters are on and taking each one off. Renders nothing when none is on.
 */
export function FilterChips({ chips, onClearAll }: {
  chips: { label: string; onRemove: () => void }[];
  onClearAll: () => void;
}): VNode | null {
  if (!chips.length) return null;
  return html`<div class="k-chips">
    <span class="k-note">Showing</span>
    ${chips.map((c) => html`<span class="k-chip" key=${c.label}>${c.label}
      <button type="button" aria-label=${`Remove filter ${c.label}`} onClick=${c.onRemove}>×</button></span>`)}
    <button type="button" class="btn small ghost" onClick=${onClearAll}>Clear all</button>
  </div>`;
}
