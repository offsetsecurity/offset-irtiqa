import { useMemo, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import type { LinkOption } from "./Register.js";

/** Lists at most this many rows at once; past it, searching narrows the list. */
const SHOWN = 300;

/**
 * Picks several things from a list: every choice with a tick box, in a list
 * that scrolls, and a search box to narrow it.
 *
 * Everything is listed rather than the first few matches, so nobody thinks a
 * risk is missing because it was ninth. A thousand controls is still too many
 * to scroll, so past that the search does the work. Where the caller allows it,
 * text that matches nothing can be added as a new item on the spot.
 */
export function LinkPicker({ options, value, onChange, placeholder = "Search to add…", empty, suggested = [], create }: {
  options: LinkOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  /** Said when there is nothing to pick from at all. */
  empty?: string;
  /** Ids worth offering first, as one-click chips. */
  suggested?: string[];
  /** Lets a search that finds nothing become a new item, linked at once. */
  create?: { label: (text: string) => string; run: (text: string) => Promise<string> };
}): VNode {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const needle = q.trim().toLowerCase();
  const all = useMemo(
    () => options.filter((o) => !needle || `${o.label} ${o.detail ?? ""}`.toLowerCase().includes(needle)),
    [options, needle],
  );
  const shown = all.slice(0, SHOWN);
  const hidden = all.length - shown.length;
  // Offered when nothing is called exactly this already, ignoring a "#7 " number in front.
  const bare = (label: string): string => label.replace(/^#\d+\s+/, "").trim().toLowerCase();
  const canCreate = Boolean(create) && needle.length > 1 && !options.some((o) => bare(o.label) === needle);

  const toggle = (id: string): void => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  const addNew = async (): Promise<void> => {
    if (!create) return;
    setCreating(true);
    setCreateError("");
    try {
      const id = await create.run(q.trim());
      onChange([...value, id]);
      setQ("");
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  if (!options.length && !value.length && !create) {
    return html`<p class="muted" style="margin:0;font-size:12px">${empty ?? "Nothing to link to yet."}</p>`;
  }
  return html`
    <div class="lp">
      ${suggested.filter((id) => !value.includes(id) && byId.has(id)).length
        ? html`<div class="lp-suggest">
            <span class="muted">Suggested:</span>
            ${suggested.filter((id) => !value.includes(id) && byId.has(id)).map((id) => html`
              <button type="button" class="chip lp-sug" title=${byId.get(id)?.detail ?? ""}
                      onClick=${() => onChange([...value, id])}>+ ${byId.get(id)!.label}</button>`)}
            <button type="button" class="linkish"
                    onClick=${() => onChange([...value, ...suggested.filter((id) => !value.includes(id) && byId.has(id))])}>Add all</button>
          </div>`
        : null}
      ${value.length
        ? html`<div class="lp-chips">
            ${value.map((id) => html`<button type="button" class="chip" title="Remove this link"
                onClick=${() => onChange(value.filter((v) => v !== id))}>
                ${byId.get(id)?.label ?? id.slice(0, 8)} ×</button>`)}
          </div>`
        : null}
      <input type="search" class="lp-search" placeholder=${placeholder} value=${q}
             aria-label=${placeholder} onInput=${(e: Event) => setQ((e.target as HTMLInputElement).value)} />
      <div class="lp-list" role="listbox" aria-multiselectable="true">
        ${shown.map((o) => html`<label class=${`lp-opt${value.includes(o.id) ? " on" : ""}`} role="option" aria-selected=${value.includes(o.id)}>
            <input type="checkbox" checked=${value.includes(o.id)} onChange=${() => toggle(o.id)} />
            <span><b>${o.label}</b>${o.detail ? html` <span class="muted">${o.detail}</span>` : null}</span>
          </label>`)}
        ${!shown.length && !canCreate
          ? html`<div class="muted lp-none">${needle ? "Nothing matches." : empty ?? "Nothing to link to yet."}</div>`
          : null}
        ${hidden > 0
          ? html`<div class="muted lp-more">and ${hidden} more. Type to narrow the list.</div>`
          : null}
        ${canCreate
          ? html`<button type="button" class="lp-create" disabled=${creating} onClick=${() => void addNew()}>
              ${creating ? "Adding…" : create!.label(q.trim())}</button>`
          : null}
      </div>
      ${createError ? html`<div class="err" role="alert" style="margin-top:6px">${createError}</div>` : null}
    </div>`;
}
