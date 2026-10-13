import type { VNode } from "preact";
import { html } from "./html.js";

const PRODUCT_NAME = import.meta.env.PRODUCT_NAME as unknown as string;
const FRAMEWORK = import.meta.env.FRAMEWORK as unknown as string;
const EDITION = import.meta.env.EDITION as unknown as string;
const PRODUCT = import.meta.env.PRODUCT as unknown as string;

// The same marks as the product menu on offsetsecurity.net.
const MARKS: Record<string, string> = {
  assure: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  align: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.8"/>',
  anchor: '<circle cx="12" cy="5.5" r="2.5"/><path d="M12 8v13M8 12h8M4.5 13.5a7.5 7.5 0 0 0 15 0"/>',
  ascend: '<path d="M3.5 17.5 9 12l4 4 7.5-7.5"/><path d="M15 8.5h5.5V14"/>',
  abide: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/><path d="M7.5 12.5h2.2l1.3-2.3 2 4.3 1.3-2h2.2"/>',
};

/** This product's own mark, in the colour of the text around it. */
export function ProductMark({ cls = "pmark" }: { cls?: string } = {}): VNode {
  return html`<svg class=${cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: MARKS[PRODUCT] ?? MARKS["assure"] }}></svg>`;
}

/**
 * The stacked wordmark used in the sidebar and on the login card.
 *
 * One colour, not the two-colour logo: white straight on the dark sidebar,
 * navy on the white login card. The two-colour version only ever looked right
 * on a white box, and a white box in a dark sidebar looks pasted on.
 */
export function Brand({ onDark = false }: { onDark?: boolean } = {}): VNode {
  // In the sidebar the product leads: its own mark and name. Offset Security is
  // credited at the foot of the menu instead.
  if (onDark) {
    return html`
      <div class="brand on-dark side">
        <span class="ptile"><${ProductMark} /></span>
        <div class="names">
          <div class="pname">${PRODUCT_NAME}</div>
          <div class="fw">${FRAMEWORK}</div>
          ${EDITION ? html`<div class="edition">${EDITION}</div>` : null}
        </div>
      </div>`;
  }
  const logo = onDark ? "logo-mono-white-notagline.svg" : "logo-mono-navy-notagline.svg";
  return html`
    <div class=${`brand${onDark ? " on-dark" : ""}`}>
      <img src=${`/assets/brand/${logo}`} alt="Offset Security" />
      <div class="product">${PRODUCT_NAME.replace(/^Offset\s+/, "")}</div>
      <div class="fw">for ${FRAMEWORK}</div>
      ${EDITION ? html`<div class="edition">${EDITION}</div>` : null}
    </div>`;
}
