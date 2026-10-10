import { html } from "./html.js";
import type { VNode } from "preact";

/**
 * Hand-drawn SVG rather than a charting library.
 *
 * These are simple shapes with fixed geometry, and a library would be larger
 * than the whole rest of the bundle. Ported from the standalone HTML tools, so
 * the shapes are the ones already reviewed and signed off there.
 */

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/** Ring chart. The hole is where the headline number goes. */
export function donut(slices: Slice[], centre: string, caption: string): VNode {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const R = 62;
  const C = 2 * Math.PI * R;

  let offset = 0;
  const rings = slices
    .filter((s) => s.value > 0)
    .map((s) => {
      const len = total ? (s.value / total) * C : 0;
      const dash = `${len} ${C - len}`;
      const node = html`<circle
        cx="80" cy="80" r=${R} fill="none" stroke=${s.color} stroke-width="20"
        stroke-dasharray=${dash} stroke-dashoffset=${-offset}
        transform="rotate(-90 80 80)"
      ><title>${s.label}: ${s.value}</title></circle>`;
      offset += len;
      return node;
    });

  return html`
    <svg viewBox="0 0 160 160" width="160" height="160" role="img"
         aria-label=${`${caption}: ${centre}`}>
      <circle cx="80" cy="80" r=${R} fill="none" stroke="#eef1f7" stroke-width="20" />
      ${rings}
      <text x="80" y="76" text-anchor="middle" font-size="26" font-weight="800" fill="#0f172a">${centre}</text>
      <text x="80" y="94" text-anchor="middle" font-size="9.5" font-weight="700"
            letter-spacing="0.08em" fill="#64748b">${caption.toUpperCase()}</text>
    </svg>`;
}

/**
 * Hexagonal radar over the six CSF Functions. Degrades to any axis count, so
 * the other two products can reuse it.
 */
export function radar(axes: { key: string; label: string; pct: number }[]): VNode {
  const size = 260;
  const c = size / 2;
  const R = 92;
  const n = Math.max(axes.length, 3);

  const point = (i: number, r: number): [number, number] => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [c + r * Math.cos(angle), c + r * Math.sin(angle)];
  };
  const poly = (r: number): string =>
    Array.from({ length: n }, (_, i) => point(i, r).join(",")).join(" ");

  const value = axes
    .map((a, i) => point(i, (Math.max(0, Math.min(100, a.pct)) / 100) * R).join(","))
    .join(" ");

  return html`
    <svg viewBox=${`0 0 ${size} ${size}`} width="100%" height="260" role="img"
         aria-label="Readiness by function">
      ${[0.25, 0.5, 0.75, 1].map(
        (f) => html`<polygon points=${poly(R * f)} fill="none" stroke="#e6eaf2" stroke-width="1" />`,
      )}
      ${axes.map((_, i) => {
        const [x, y] = point(i, R);
        return html`<line x1=${c} y1=${c} x2=${x} y2=${y} stroke="#e6eaf2" stroke-width="1" />`;
      })}
      <polygon points=${value} fill="rgba(36,87,214,.18)" stroke="#2457D6" stroke-width="2"
               stroke-linejoin="round" />
      ${axes.map((a, i) => {
        const [x, y] = point(i, (Math.max(0, Math.min(100, a.pct)) / 100) * R);
        return html`<circle cx=${x} cy=${y} r="3.5" fill="#2457D6"><title>${a.label}: ${a.pct}%</title></circle>`;
      })}
      ${axes.map((a, i) => {
        const [x, y] = point(i, R + 20);
        return html`<text x=${x} y=${y} text-anchor="middle" dominant-baseline="middle"
                          font-size="10.5" font-weight="800" fill="#334155">${a.key}</text>`;
      })}
    </svg>`;
}

/**
 * The 5x5 likelihood-by-impact grid every risk register is judged on.
 *
 * Impact runs left to right, likelihood bottom to top, so the dangerous corner
 * is top-right — the orientation an auditor expects. Cell keys match the API's
 * summary, which builds them as `impact x likelihood`.
 */
export function heatmap(
  counts: Record<string, number>,
  onPick?: (impact: number, likelihood: number) => void,
): VNode {
  const shade = (score: number): string => {
    if (score >= 20) return "#dc2626";
    if (score >= 12) return "#ea580c";
    if (score >= 6) return "#d97706";
    return "#16a34a";
  };

  const rows = [5, 4, 3, 2, 1].map(
    (likelihood) => html`
      <div class="hm-row">
        <div class="hm-axis">${likelihood}</div>
        ${[1, 2, 3, 4, 5].map((impact) => {
          const n = counts[`${impact}x${likelihood}`] ?? 0;
          const score = impact * likelihood;
          return html`
            <button
              type="button"
              class=${`hm-cell${n ? " has" : ""}`}
              style=${`background:${shade(score)};opacity:${n ? 1 : 0.14}`}
              title=${`Likelihood ${likelihood} × Impact ${impact} = ${score}${n ? ` — ${n} risk(s)` : ""}`}
              onClick=${onPick ? () => onPick(impact, likelihood) : undefined}
              disabled=${!onPick || !n}
            >${n || ""}</button>`;
        })}
      </div>`,
  );

  return html`
    <div class="heatmap">
      <div class="hm-cap">Likelihood ↑</div>
      ${rows}
      <div class="hm-row">
        <div class="hm-axis"></div>
        ${[1, 2, 3, 4, 5].map((i) => html`<div class="hm-axis bottom">${i}</div>`)}
      </div>
      <div class="hm-cap end">Impact →</div>
    </div>`;
}

/**
 * Readiness per theme as a grid of tiles.
 *
 * The radar is right for six CSF Functions and four ISO themes. It is not right
 * for twenty 800-53 families: twenty axes on one polygon is a scribble. Same
 * question, a shape that can actually answer it at that size.
 */
export function themeGrid(
  items: { key: string; label: string; pct: number; total: number; applicable: number }[],
): VNode {
  const shade = (p: number): string => {
    if (p >= 80) return "#16a34a";
    if (p >= 60) return "#65a30d";
    if (p >= 40) return "#d97706";
    if (p >= 20) return "#ea580c";
    return "#dc2626";
  };
  return html`
    <div class="theme-grid">
      ${items.map((t) => {
        // Nothing applicable is not the same as nothing done. A family scoped
        // out by the baseline must not read as a score of zero.
        if (t.applicable === 0) {
          return html`
            <div class="theme-tile out" title=${`${t.label} — all ${t.total} out of scope`}>
              <div class="theme-key">${t.key}</div>
              <div class="theme-pct">—</div>
              <div class="theme-meter"></div>
            </div>`;
        }
        return html`
          <div class="theme-tile" title=${`${t.label} — ${t.pct}% of ${t.applicable} in scope`}>
            <div class="theme-key">${t.key}</div>
            <div class="theme-pct" style=${`color:${shade(t.pct)}`}>${t.pct}%</div>
            <div class="theme-meter">
              <span style=${`width:${Math.max(2, t.pct)}%;background:${shade(t.pct)}`}></span>
            </div>
          </div>`;
      })}
    </div>`;
}

/** Horizontal progress bar used for the per-function readiness rows. */
export function bar(pctValue: number, color: string): VNode {
  const width = Math.max(0, Math.min(100, pctValue));
  return html`
    <div class="bar" role="img" aria-label=${`${width}%`}>
      <span style=${`width:${width}%;background:${color}`}></span>
    </div>`;
}
