import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { Icon, type IconName } from "./icons.js";

/** One thing the palette can open: a screen, or an action such as signing out. */
export interface PaletteItem {
  id: string;
  label: string;
  group: string;
  icon: IconName;
  /** A second line of words to match on, and to show at the right. */
  hint?: string;
  run: () => void;
}

/** Every word typed must start a word in the item, in any order: "ev up" finds "Evidence · Upload". */
function matches(item: PaletteItem, q: string): number {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const hay = `${item.label} ${item.group} ${item.hint ?? ""}`.toLowerCase();
  let score = 0;
  for (const w of words) {
    const at = hay.indexOf(w);
    if (at < 0) return 0;
    // A match at the start of the label counts most, then at the start of any word.
    score += at === 0 ? 3 : /\s/.test(hay[at - 1] ?? " ") ? 2 : 1;
  }
  return score;
}

/**
 * Jump to any screen or action from the keyboard (Ctrl K, or ⌘K on a Mac).
 *
 * The product has more than thirty screens. The menu shows them by the job they
 * belong to; this finds one by name, which is how people who know the product
 * move around it.
 */
export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }): VNode {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);

  const shown = useMemo(() => {
    const scored = items.map((it) => ({ it, s: matches(it, q) })).filter((x) => x.s > 0);
    if (q.trim()) scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.it);
  }, [items, q]);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => setAt(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(".cmdk-item.on")?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const run = (it: PaletteItem | undefined): void => {
    if (!it) return;
    onClose();
    it.run();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "ArrowDown") { e.preventDefault(); setAt((n) => Math.min(n + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((n) => Math.max(n - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(shown[at]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  // Grouped while browsing; one ranked list once something is typed.
  let lastGroup = "";
  return html`
    <div class="cmdk-back" onMouseDown=${(e: MouseEvent) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="cmdk" role="dialog" aria-modal="true" aria-label="Jump to">
        <div class="cmdk-in">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input ref=${input} value=${q} placeholder="Search screens and actions…" aria-label="Search screens and actions"
                 role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant=${shown[at] ? `cmdk-${shown[at]!.id}` : undefined}
                 onInput=${(e: Event) => setQ((e.target as HTMLInputElement).value)} onKeyDown=${onKey} />
          <kbd>Esc</kbd>
        </div>
        <div class="cmdk-list" id="cmdk-list" role="listbox" ref=${list}>
          ${shown.length === 0
            ? html`<div class="cmdk-empty">Nothing called “${q}”. Try a screen name, such as Evidence or Policies.</div>`
            : shown.map((it, i) => {
                const head = !q.trim() && it.group !== lastGroup ? it.group : "";
                lastGroup = it.group;
                return html`
                  ${head ? html`<div class="cmdk-group" key=${`g-${head}`}>${head}</div>` : null}
                  <button type="button" key=${it.id} id=${`cmdk-${it.id}`} role="option" aria-selected=${i === at}
                          class=${`cmdk-item${i === at ? " on" : ""}`}
                          onMouseMove=${() => i !== at && setAt(i)} onClick=${() => run(it)}>
                    <${Icon} name=${it.icon} />
                    <span>${it.label}</span>
                    <span class="cmdk-sub">${q.trim() ? it.group : it.hint ?? ""}</span>
                  </button>`;
              })}
        </div>
        <div class="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
          <span><kbd>Enter</kbd> to open</span>
          <span style="margin-left:auto">${/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K"} opens this anywhere</span>
        </div>
      </div>
    </div>`;
}
