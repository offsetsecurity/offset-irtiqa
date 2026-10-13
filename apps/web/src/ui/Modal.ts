import { useEffect, useRef, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";

/** Whether windows open full size; remembered on this computer. */
const EXPANDED_KEY = "offset.modal.expanded";
const readExpanded = (): boolean => {
  try { return localStorage.getItem(EXPANDED_KEY) === "1"; } catch { return false; }
};

/**
 * The add/edit dialog, shared by every register.
 *
 * Uses the native `<dialog>` element, so the browser supplies the focus trap,
 * the backdrop and Escape-to-close rather than us reimplementing them badly.
 * It can be made full size with the button beside ×, which is remembered, and
 * dragged larger by its bottom-right corner.
 */
export function Modal({ title, onClose, onSubmit, submitLabel, busy, error, children, onDelete }: {
  title: string;
  onClose: () => void;
  onSubmit: (e: Event) => void;
  submitLabel: string;
  busy?: boolean;
  error?: string;
  children?: unknown;
  onDelete?: () => void;
}): VNode {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [expanded, setExpanded] = useState(readExpanded);
  const toggleSize = (): void => {
    const next = !expanded;
    setExpanded(next);
    // A size dragged by hand gives way to the button.
    ref.current?.style.removeProperty("width");
    ref.current?.style.removeProperty("height");
    try { localStorage.setItem(EXPANDED_KEY, next ? "1" : "0"); } catch { /* a private window */ }
  };

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // Escape fires `cancel`; route it through the same close path.
    const onCancel = (e: Event): void => { e.preventDefault(); onClose(); };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [onClose]);

  return html`
    <dialog class=${`modal${expanded ? " expanded" : ""}`} ref=${ref}>
      <form method="dialog" onSubmit=${onSubmit}>
        <header>
          <h2>${title}</h2>
          <span class="modal-tools">
            <button type="button" class="icon size" onClick=${toggleSize}
                    aria-label=${expanded ? "Make this window smaller" : "Make this window full size"}
                    title=${expanded ? "Make this window smaller" : "Make this window full size"}>
              ${expanded
                ? html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>`
                : html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`}
            </button>
            <button type="button" class="icon" aria-label="Close" onClick=${onClose}>×</button>
          </span>
        </header>

        <div class="modal-body">
          ${error ? html`<div class="err" role="alert">${error}</div>` : null}
          ${children}
        </div>

        <footer>
          ${onDelete
            ? html`<button type="button" class="btn danger" onClick=${onDelete} disabled=${busy}>
                Delete
              </button>`
            : null}
          <span class="spacer"></span>
          <button type="button" class="btn" onClick=${onClose} disabled=${busy}>Cancel</button>
          <button type="submit" class="btn primary" disabled=${busy}>
            ${busy ? "Saving…" : submitLabel}
          </button>
        </footer>
      </form>
    </dialog>`;
}

/** A labelled control. `wide` makes it span both columns of the form grid. */
export function Field({ label, hint, wide, children }: {
  label: string;
  hint?: string;
  wide?: boolean;
  children?: unknown;
}): VNode {
  return html`
    <label class=${`fld${wide ? " wide" : ""}`}>
      <span>${label}</span>
      ${children}
      ${hint ? html`<em class="hint">${hint}</em>` : null}
    </label>`;
}
