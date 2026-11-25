import { useState } from "preact/hooks";
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
  /** Called when the slice is clicked. A slice without it is not clickable. */
  onPick?: () => void;
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
        class=${s.onPick ? "seg" : undefined} onClick=${s.onPick}
      ><title>${s.label}: ${s.value}</title></circle>`;
      offset += len;
      return node;
    });

  return html`
    <svg viewBox="0 0 160 160" width="160" height="160" role="img"
         aria-label=${`${caption}: ${centre}`}>
      <circle cx="80" cy="80" r=${R} fill="none" stroke="#eef1f7" stroke-width="20" />
      ${rings}
      <text x="80" y="76" text-anchor="middle" font-size="26" font-weight="800" fill="#0B1220">${centre}</text>
      <text x="80" y="94" text-anchor="middle" font-size="9.5" font-weight="700"
            letter-spacing="0.08em" fill="#5D687C">${caption.toUpperCase()}</text>
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
        (f) => html`<polygon points=${poly(R * f)} fill="none" stroke="#E4E7EE" stroke-width="1" />`,
      )}
      ${axes.map((_, i) => {
        const [x, y] = point(i, R);
        return html`<line x1=${c} y1=${c} x2=${x} y2=${y} stroke="#E4E7EE" stroke-width="1" />`;
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
                          font-size="10.5" font-weight="800" fill="#2A3446">${a.key}</text>`;
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
    if (score >= 20) return "#D2333D";
    if (score >= 12) return "#D75A12";
    if (score >= 6) return "#C47A06";
    return "#14915A";
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
    if (p >= 80) return "#14915A";
    if (p >= 60) return "#65a30d";
    if (p >= 40) return "#C47A06";
    if (p >= 20) return "#D75A12";
    return "#D2333D";
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

/**
 * One tooltip for every chart: the exact value, on hover and on keyboard focus.
 * A single element in <body>, positioned next to the mark, never covering the pointer.
 * Marks that use it are focusable and carry an aria-label with the same words.
 */
let tipEl: HTMLDivElement | null = null;
/** The mark that showed the tooltip; only it may hide it. */
let tipOwner: EventTarget | null = null;
export function showTip(e: Event, text: string): void {
  const target = e.currentTarget as Element;
  const r = target.getBoundingClientRect();
  const pe = e as PointerEvent;
  const x = typeof pe.clientX === "number" && pe.clientX ? pe.clientX : r.left + r.width / 2;
  const y = typeof pe.clientY === "number" && pe.clientY ? pe.clientY : r.top;
  showTipAt(e.currentTarget, x, y, text);
}
/** The tooltip at a point on screen, owned by `owner` (a line chart's crosshair places it). */
export function showTipAt(owner: EventTarget | null, x: number, y: number, text: string): void {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "chart-tip";
    tipEl.setAttribute("role", "tooltip");
    document.body.appendChild(tipEl);
  }
  tipEl.textContent = text;
  tipOwner = owner;
  tipEl.style.left = `${Math.round(Math.min(window.innerWidth - 12, Math.max(12, x)))}px`;
  tipEl.style.top = `${Math.round(y - 12)}px`;
  tipEl.classList.add("on");
}
export function hideTip(e?: Event): void {
  if (e && tipOwner && e.currentTarget !== tipOwner) return;
  tipOwner = null;
  tipEl?.classList.remove("on");
}

export interface LinePoint { x: number; y: number; tip: string }

/**
 * A line over time with one crosshair (docs/design/redesign-v3.md, decision 4): wherever the
 * pointer is on the plot, the nearest point is marked and read out; arrow keys step through the
 * points when the chart has focus. An optional dashed projection, and labelled vertical markers.
 */
export function LineChart({ points, label, xStartLabel, xEndLabel, height = 140, yMax = 100,
  yTicks = [0, 50, 100], fmtY = (v: number) => `${v}%`, projection, markers = [], xMin, xMax, color }: {
  points: LinePoint[];
  label: string;
  xStartLabel: string;
  xEndLabel: string;
  height?: number;
  yMax?: number;
  yTicks?: number[];
  fmtY?: (v: number) => string;
  projection?: LinePoint;
  markers?: { x: number; label: string }[];
  xMin?: number;
  xMax?: number;
  color?: string;
}): VNode {
  const [on, setOn] = useState<number | null>(null);
  const W = 600, L = 48, R = 48, T = 10, H = height, VH = H + 24;
  const lo = xMin ?? points[0]?.x ?? 0;
  const hi = Math.max(xMax ?? 0, points.at(-1)?.x ?? 1, projection?.x ?? 0, lo + 1);
  const x = (v: number): number => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const y = (v: number): number => T + (1 - Math.max(0, Math.min(yMax, v)) / yMax) * (H - T);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  const last = points.at(-1);
  const all: LinePoint[] = projection ? [...points, projection] : points;

  const pick = (svg: SVGSVGElement, i: number): void => {
    setOn(i);
    const p = all[i]!;
    const r = svg.getBoundingClientRect();
    showTipAt(svg, r.left + (x(p.x) / W) * r.width, r.top + (y(p.y) / VH) * r.height, p.tip);
  };
  const read = (e: PointerEvent): void => {
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    all.forEach((p, i) => { if (Math.abs(x(p.x) - px) < Math.abs(x(all[best]!.x) - px)) best = i; });
    if (best !== on) pick(svg, best);
  };
  const key = (e: KeyboardEvent): void => {
    const n = all.length;
    const cur = on ?? n - 1;
    const next = e.key === "ArrowLeft" ? Math.max(0, cur - 1) : e.key === "ArrowRight" ? Math.min(n - 1, cur + 1)
      : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    pick(e.currentTarget as SVGSVGElement, next);
  };
  const leave = (e: Event): void => { setOn(null); hideTip(e); };
  const a = on === null ? null : all[on]!;

  return html`<svg class="trend lc" viewBox=${`0 0 ${W} ${VH}`} role="img" tabIndex=${0}
      aria-label=${`${label}. Use the arrow keys to read each point.`}
      style=${color ? `--lc:${color}` : undefined}
      onPointerMove=${read} onPointerDown=${read} onPointerLeave=${leave}
      onFocus=${(e: FocusEvent) => pick(e.currentTarget as SVGSVGElement, on ?? all.length - 1)} onBlur=${leave} onKeyDown=${key}>
    ${yTicks.map((v) => html`<line x1=${L} x2=${W - R} y1=${y(v)} y2=${y(v)} class="grid-line" />
      <text x=${L - 8} y=${y(v) + 4} class="axis" text-anchor="end">${fmtY(v)}</text>`)}
    ${markers.map((m) => html`<line x1=${x(m.x)} x2=${x(m.x)} y1=${T} y2=${H} class="lc-marker" />
      <text x=${x(m.x)} y=${T + 12} class="axis lc-marker-label" text-anchor="middle">${m.label}</text>`)}
    ${points.length > 1
      ? html`<path d=${`${path} L${x(last!.x).toFixed(1)},${y(0)} L${x(points[0]!.x).toFixed(1)},${y(0)} Z`} class="trend-area" />
          <path d=${path} class="trend-line" pathLength="1" />`
      : null}
    ${projection && last
      ? html`<line x1=${x(last.x)} y1=${y(last.y)} x2=${x(projection.x)} y2=${y(projection.y)} class="lc-proj" />
          <circle cx=${x(projection.x)} cy=${y(projection.y)} r="4" class="lc-proj-dot" />`
      : null}
    ${last ? html`<circle cx=${x(last.x)} cy=${y(last.y)} r="3.5" class="dot" />
      <text x=${x(last.x) + 8} y=${y(last.y) + 4} class="end-label">${fmtY(last.y)}</text>` : null}
    ${a ? html`<line x1=${x(a.x)} x2=${x(a.x)} y1=${T} y2=${H} class="lc-guide" />
      <circle cx=${x(a.x)} cy=${y(a.y)} r="5.5" class="lc-dot" />` : null}
    <text x=${L} y=${H + 18} class="axis">${xStartLabel}</text>
    <text x=${W - R} y=${H + 18} class="axis" text-anchor="end">${xEndLabel}</text>
  </svg>`;
}
