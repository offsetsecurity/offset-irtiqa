import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";

const reduced = (): boolean => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A number that counts up to its value when it first appears, then follows it.
 * Used for the few headline numbers only, so the eye lands on them.
 */
export function useCountUp(target: number, ms = 900, delay = 120): number {
  const [n, setN] = useState(reduced() ? target : 0);
  useEffect(() => {
    if (reduced()) { setN(target); return undefined; }
    let raf = 0;
    const from = n;
    const t0 = performance.now() + delay;
    const tick = (t: number): void => {
      const k = Math.min(1, Math.max(0, (t - t0) / ms));
      setN(Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return n;
}

let ringId = 0;

/**
 * Readiness as a ring in the brand gradient, drawn from empty on first view.
 * `label` sits under the number; the number itself counts up with the ring.
 */
export function Ring({ pct, size = 132, stroke = 11, label, sub }: {
  pct: number; size?: number; stroke?: number; label?: string; sub?: string;
}): VNode {
  const [id] = useState(() => `ring${++ringId}`);
  const shown = useCountUp(Math.max(0, Math.min(100, Math.round(pct))));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return html`
    <div class="ring" style=${`width:${size}px;height:${size}px`} role="img" aria-label=${`${Math.round(pct)}%${label ? ` ${label}` : ""}`}>
      <svg viewBox=${`0 0 ${size} ${size}`} width=${size} height=${size} aria-hidden="true">
        <defs><linearGradient id=${id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#2457D6" /><stop offset=".55" stop-color="#4F7BFF" /><stop offset="1" stop-color="#19B49E" />
        </linearGradient></defs>
        <circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke="var(--surface-2)" stroke-width=${stroke} />
        <circle class="ring-arc" cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke=${`url(#${id})`} stroke-width=${stroke}
                stroke-linecap="round" stroke-dasharray=${c} stroke-dashoffset=${c * (1 - shown / 100)}
                transform=${`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div class="ring-in">
        <b>${shown}<small>%</small></b>
        ${label ? html`<span>${label}</span>` : null}
        ${sub ? html`<em>${sub}</em>` : null}
      </div>
    </div>`;
}

/** Morning, afternoon or evening, by the clock on this computer. */
export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const CONFETTI = ["#2457D6", "#4F7BFF", "#19B49E", "#6B5BD6", "#F2B33D", "#E8607A"];

/**
 * A short burst when a whole stage of the plan is finished, and a line saying
 * which. It shows once and clears itself; nobody has to dismiss it. Skipped
 * entirely for people who ask their computer for less motion.
 */
export function Celebrate({ title, onDone }: { title: string; onDone: () => void }): VNode | null {
  useEffect(() => {
    const t = setTimeout(onDone, 3600);
    return () => clearTimeout(t);
  }, []);
  const still = reduced();
  const bits = still ? [] : Array.from({ length: 36 }, (_, i) => {
    const angle = (i / 36) * Math.PI * 2 + (i % 3) * 0.2;
    const dist = 120 + ((i * 37) % 140);
    return {
      x: Math.cos(angle) * dist, y: Math.sin(angle) * dist * 0.7 - 60,
      r: (i * 47) % 360, c: CONFETTI[i % CONFETTI.length]!, d: (i % 6) * 18, w: 6 + (i % 3) * 2,
    };
  });
  return html`
    <div class="celebrate" role="status" aria-live="polite">
      <div class="celebrate-burst" aria-hidden="true">
        ${bits.map((b) => html`<i style=${`--x:${b.x}px;--y:${b.y}px;--r:${b.r}deg;background:${b.c};animation-delay:${b.d}ms;width:${b.w}px`}></i>`)}
      </div>
      <div class="celebrate-card">
        <span class="celebrate-tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></span>
        <span><b>Stage complete</b>${title}</span>
      </div>
    </div>`;
}
