import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { evidence as api, type Evidence } from "../persistence/apiClient.js";

/**
 * The proof attached to one control.
 *
 * These are the same records the Evidence screen lists - not a copy. Attaching
 * something here makes it appear there, and anything linked there appears here,
 * because both read and write the one evidence table and its links to controls.
 * A separate per-control store would have been less code today and two
 * disagreeing lists by next month.
 *
 * Three ways in, because customers arrive with their proof in three states:
 * a file on disk, an item already recorded, or a thing that exists in the world
 * but not yet in the product.
 */

const TYPES = ["Document", "Screenshot", "Export", "Report", "Approval", "Minutes", "Assessment", "Log"];

const KB = 1024;
const size = (bytes: number | null): string => {
  if (bytes === null) return "";
  if (bytes < KB) return `${bytes} B`;
  if (bytes < KB * KB) return `${Math.round(bytes / KB)} KB`;
  return `${(bytes / KB / KB).toFixed(1)} MB`;
};

export function ControlEvidence({
  controlId,
  controlRef,
  canEdit,
  onChange,
}: {
  controlId: string;
  controlRef: string;
  canEdit: boolean;
  onChange?: () => void;
}): VNode {
  const [all, setAll] = useState<Evidence[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Which panel is open: nothing, the picker, or the new-item form. */
  const [mode, setMode] = useState<"" | "link" | "new">("");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState({ name: "", type: TYPES[0]!, owner: "" });

  async function load(): Promise<void> {
    const { evidence } = await api.list();
    setAll(evidence);
  }

  useEffect(() => {
    let live = true;
    api
      .list()
      .then(({ evidence }) => live && setAll(evidence))
      .catch((err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  async function run(work: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
      onChange?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Link or unlink by rewriting the item's control list, which is what the API takes. */
  const setLinked = (item: Evidence, linked: boolean): Promise<void> =>
    run(() =>
      api.update(item.id, {
        controlIds: linked
          ? [...new Set([...item.control_ids, controlId])]
          : item.control_ids.filter((id) => id !== controlId),
      }),
    );

  /**
   * A file becomes an evidence item named after itself, linked here, with the
   * document attached. Two calls rather than one: the record has to exist
   * before a file can hang off it.
   */
  const upload = (file: File): Promise<void> =>
    run(async () => {
      const { evidence: created } = await api.create({
        name: file.name.replace(/\.[^.]+$/, ""),
        type: "Document",
        owner: "",
        collectedDate: new Date().toISOString().slice(0, 10),
        nextReview: null,
        notes: `Attached from ${controlRef}.`,
        controlIds: [controlId],
      });
      await api.attach(created.id, file);
    });

  const addEmpty = (): Promise<void> =>
    run(async () => {
      await api.create({
        name: draft.name.trim(),
        type: draft.type,
        owner: draft.owner.trim(),
        collectedDate: new Date().toISOString().slice(0, 10),
        nextReview: null,
        notes: "",
        controlIds: [controlId],
      });
      setDraft({ name: "", type: TYPES[0]!, owner: "" });
      setMode("");
    });

  if (all === null) {
    return html`<div class="ev-panel">
      <div class="ev-head">Evidence</div>
      <p class="muted" style="margin:0">${error || "Loading…"}</p>
    </div>`;
  }

  const linked = all.filter((e) => e.control_ids.includes(controlId));
  const needle = q.trim().toLowerCase();
  const candidates = all
    .filter((e) => !e.control_ids.includes(controlId))
    .filter((e) => !needle || `${e.name} ${e.type} ${e.owner}`.toLowerCase().includes(needle))
    .slice(0, 8);

  return html`
    <div class="ev-panel">
      <div class="ev-head">
        Evidence
        <span class="muted">
          ${linked.length
            ? `${linked.length} attached · also in the Evidence tab`
            : "nothing attached yet"}
        </span>
      </div>

      ${error ? html`<div class="err" style="margin-bottom:8px">${error}</div>` : null}

      ${linked.length
        ? html`<div class="ev-list">
            ${linked.map(
              (e) => html`<div class="ev-row" key=${e.id}>
                <div class="ev-main">
                  <div class="ev-name">${e.name}</div>
                  <div class="ev-meta muted">
                    ${e.type}${e.owner ? ` · ${e.owner}` : ""}
                    ${e.collected_date ? ` · collected ${e.collected_date}` : " · no date"}
                    ${e.file_name ? ` · ${e.file_name} (${size(e.file_size)})` : ""}
                  </div>
                </div>
                ${e.file_name
                  ? html`<a class="btn small" href=${api.fileUrl(e.id)} target="_blank"
                           rel="noopener">Open</a>`
                  : null}
                ${canEdit
                  ? html`<button type="button" class="btn small ghost" disabled=${busy}
                           title="Unlink from this control. The evidence itself is kept."
                           onClick=${() => void setLinked(e, false)}>Unlink</button>`
                  : null}
              </div>`,
            )}
          </div>`
        : html`<p class="muted ev-empty">
            Anything you scored 3 or above, an assessor will ask you to show. Attach it here
            and it lands in the Evidence tab too.
          </p>`}

      ${canEdit
        ? html`<div class="ev-actions">
            <label class="btn small primary ev-file">
              Upload a file
              <input type="file" disabled=${busy}
                onChange=${(e: Event) => {
                  const input = e.target as HTMLInputElement;
                  const file = input.files?.[0];
                  if (file) void upload(file);
                  // Cleared so choosing the same file twice still fires.
                  input.value = "";
                }} />
            </label>
            <button type="button" class="btn small" disabled=${busy}
              onClick=${() => setMode(mode === "link" ? "" : "link")}>
              Link something I already have
            </button>
            <button type="button" class="btn small" disabled=${busy}
              onClick=${() => setMode(mode === "new" ? "" : "new")}>
              Record it without a file
            </button>
          </div>`
        : null}

      ${mode === "link"
        ? html`<div class="ev-picker">
            <p class="muted" style="margin:0 0 8px">
              Evidence already recorded for other controls. Pick one to use it for this
              control as well. Nothing below is linked here until you pick it.
            </p>
            <input placeholder="Search your evidence…" value=${q}
              onInput=${(e: Event) => setQ((e.target as HTMLInputElement).value)} />
            ${candidates.length
              ? candidates.map(
                  (e) => html`<button type="button" class="ev-pick" key=${e.id} disabled=${busy}
                    onClick=${() => void setLinked(e, true)}>
                    <span>${e.name}</span>
                    <span class="muted">${e.type}${e.file_name ? " · has a file" : ""}</span>
                  </button>`,
                )
              : html`<p class="muted" style="margin:6px 0 0">
                  ${all.length ? "Nothing else matches." : "You have not recorded any evidence yet."}
                </p>`}
          </div>`
        : null}

      ${mode === "new"
        ? html`<div class="ev-picker">
            <p class="muted" style="margin:0 0 8px">
              For proof that exists somewhere else — a signed policy in a filing cabinet, a
              report in another system. Record what it is and where.
            </p>
            <input placeholder="What is it? e.g. Board minutes approving the policy"
              value=${draft.name}
              onInput=${(e: Event) =>
                setDraft({ ...draft, name: (e.target as HTMLInputElement).value })} />
            <div class="ev-new-row">
              <select value=${draft.type}
                onChange=${(e: Event) =>
                  setDraft({ ...draft, type: (e.target as HTMLSelectElement).value })}>
                ${TYPES.map((t) => html`<option value=${t}>${t}</option>`)}
              </select>
              <input placeholder="Owner" value=${draft.owner}
                onInput=${(e: Event) =>
                  setDraft({ ...draft, owner: (e.target as HTMLInputElement).value })} />
              <button type="button" class="btn small primary" disabled=${busy || !draft.name.trim()}
                onClick=${() => void addEmpty()}>Add</button>
            </div>
          </div>`
        : null}
    </div>`;
}
