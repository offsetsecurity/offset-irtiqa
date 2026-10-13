import { useEffect, useMemo, useState } from "preact/hooks";
import { useTarget, settle, goBack, focusFix, type Target } from "./deepLink.js";
import type { VNode } from "preact";
import { html } from "./html.js";
import { Modal, Field } from "./Modal.js";
import {
  evidence, evidenceToInput, controls,
  type Evidence as EvidenceRow, type EvidenceInput, type Freshness, type Control,
} from "../persistence/apiClient.js";
import { since, plural } from "./format.js";

/** The 30-60-90 ladder the API computes. Order matters: worst first. */
const FRESHNESS: { key: Freshness; label: string; colour: string; note: string }[] = [
  { key: "stale", label: "Stale", colour: "#dc2626", note: "older than 90 days" },
  { key: "due", label: "Due", colour: "#ea580c", note: "60–90 days" },
  { key: "ageing", label: "Ageing", colour: "#d97706", note: "30–60 days" },
  { key: "fresh", label: "Fresh", colour: "#16a34a", note: "within 30 days" },
  { key: "unknown", label: "No date", colour: "#94a3b8", note: "never recorded" },
];

const TYPES = ["Document", "Screenshot", "Export", "Report", "Approval", "Minutes", "Assessment", "Log"];

const today = (): string => new Date().toISOString().slice(0, 10);
const blank = (): EvidenceInput => ({
  name: "", type: "Document", owner: "", ownerEmail: "", collectedDate: today(),
  nextReview: null, notes: "", controlIds: [],
});

/**
 * The evidence register.
 *
 * Freshness is the whole point: an assessor wants recent proof, and evidence
 * decays. The badge and the age both come from the API so the register and the
 * dashboard cannot disagree about what counts as stale.
 */
/** Bytes, as a person would say them. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The attached document, and the controls for it.
 *
 * Its own component because it holds state per row — which file is being
 * uploaded, and what went wrong — and a single piece of state on the screen
 * would make every row show the same error.
 *
 * The download is an ordinary link rather than a fetch. The server sends the
 * file as an attachment, so the browser saves it without leaving the page,
 * and the session cookie goes along on its own.
 */
function FileCell({
  evidence: e,
  canEdit,
  onChanged,
}: {
  evidence: EvidenceRow;
  canEdit: boolean;
  onChanged: () => void;
}): VNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await evidence.attach(e.id, file);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      // Let the same file be chosen again after a failure.
      input.value = "";
    }
  }

  async function detach(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await evidence.detach(e.id);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (busy) return html`<span class="muted">Working…</span>`;

  return html`
    ${error ? html`<div class="err" style="margin:0 0 4px">${error}</div>` : null}
    ${e.file_name
      ? html`<div class="file-cell">
          <a href=${evidence.fileUrl(e.id)} download=${e.file_name} title=${e.file_name}>
            ${e.file_name}
          </a>
          <span class="muted">${e.file_size == null ? "" : humanSize(e.file_size)}</span>
          ${canEdit
            ? html`<button class="linkish danger" type="button" onClick=${detach}>Remove</button>`
            : null}
        </div>`
      : canEdit
        ? html`<label class="linkish file-pick">
            Attach a file
            <input type="file" onChange=${pick} />
          </label>`
        : html`<span class="muted">—</span>`}`;
}

export function Evidence({ itemLabel, canEdit }: { itemLabel: string; canEdit: boolean }): VNode {
  const [rows, setRows] = useState<EvidenceRow[]>([]);
  const [catalogue, setCatalogue] = useState<Control[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [freshness, setFreshness] = useState("");

  const [editing, setEditing] = useState<EvidenceRow | null>(null);
  // Opened from a link such as the Golden thread's fix buttons.
  const target = useTarget("evidence");
  const [opened, setOpened] = useState<Target | null>(null);
  const [draft, setDraft] = useState<EvidenceInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all([evidence.list(), controls.list()])
      .then(([e, c]) => {
        if (!live) return;
        setRows(e.evidence);
        setCatalogue(c.controls);
      })
      .catch((err: Error) => live && setError(err.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  const reload = async (): Promise<void> => {
    const { evidence: list } = await evidence.list();
    setRows(list);
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (e) =>
        (!freshness || e.freshness === freshness) &&
        (!needle ||
          e.name.toLowerCase().includes(needle) ||
          e.type.toLowerCase().includes(needle) ||
          e.owner.toLowerCase().includes(needle)),
    );
  }, [rows, q, freshness]);

  const byRef = useMemo(() => {
    const map = new Map<string, Control>();
    for (const c of catalogue) map.set(c.id, c);
    return map;
  }, [catalogue]);

  function open(row: EvidenceRow | null): void {
    setEditing(row);
    setDraft(row ? evidenceToInput(row) : blank());
    setFormError("");
  }
  const close = (): void => {
    setEditing(null);
    setDraft(null);
    const from = opened;
    setOpened(null);
    goBack(from);
  };
  const set = (patch: Partial<EvidenceInput>): void =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  useEffect(() => {
    if (!target || !rows.length) return;
    const row = rows.find((e) => e.id === target.id);
    settle("evidence");
    if (!row) { setError("That evidence is no longer recorded."); return; }
    setOpened(target);
    open(row);
    if (target.fix) focusFix(target.fix);
  }, [target, rows]);

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setFormError("");
    try {
      if (editing) await evidence.update(editing.id, draft);
      else await evidence.create(draft);
      await reload();
      close();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!editing) return;
    setBusy(true);
    try {
      await evidence.remove(editing.id);
      await reload();
      close();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Toggle one control on the draft's link list. */
  const toggleLink = (id: string): void =>
    setDraft((d) => {
      if (!d) return d;
      const linked = new Set(d.controlIds ?? []);
      if (linked.has(id)) linked.delete(id);
      else linked.add(id);
      return { ...d, controlIds: [...linked] };
    });

  if (loading) return html`<div class="card pad muted">Loading…</div>`;
  if (error) return html`<div class="card pad err">${error}</div>`;

  const meta = (key: Freshness): (typeof FRESHNESS)[number] =>
    FRESHNESS.find((f) => f.key === key) ?? FRESHNESS[FRESHNESS.length - 1]!;

  return html`<>
    <div class="card pad" style="margin-bottom:16px">
      <div class="section-title"><h2>Freshness</h2>
        <span class="muted" style="font-size:12px">evidence ages — an assessor wants recent proof</span>
      </div>
      <div class="fresh-strip">
        ${FRESHNESS.map((f) => {
          const n = rows.filter((e) => e.freshness === f.key).length;
          const active = freshness === f.key;
          return html`
            <button type="button" class=${`fresh-tile${active ? " active" : ""}`}
                    style=${`--tile:${f.colour}`}
                    onClick=${() => setFreshness(active ? "" : f.key)}>
              <div class="fresh-n">${n}</div>
              <div class="fresh-l">${f.label}</div>
              <div class="fresh-note">${f.note}</div>
            </button>`;
        })}
      </div>
    </div>

    <div class="card pad">
      <div class="toolbar">
        <input type="search" placeholder="Search evidence…" value=${q}
               onInput=${(e: Event) => setQ((e.target as HTMLInputElement).value)} />
        <select value=${freshness} onChange=${(e: Event) => setFreshness((e.target as HTMLSelectElement).value)}>
          <option value="">All ages</option>
          ${FRESHNESS.map((f) => html`<option value=${f.key}>${f.label}</option>`)}
        </select>
        <div class="toolbar-note muted">${shown.length} of ${rows.length}</div>
        ${canEdit
          ? html`<button class="btn primary" onClick=${() => open(null)}>Add evidence</button>`
          : null}
      </div>

      <table>
        <thead>
          <tr>
            <th>Evidence</th>
            <th style="width:120px">Type</th>
            <th style="width:150px">Owner</th>
            <th style="width:120px">Collected</th>
            <th style="width:110px">Age</th>
            <th style="width:90px">Linked</th>
            <th style="width:210px">Document</th>
          </tr>
        </thead>
        <tbody>
          ${shown.map((e) => {
            const f = meta(e.freshness);
            return html`
              <tr key=${e.id} class=${canEdit ? "clickable" : ""}
                  onClick=${canEdit ? () => open(e) : undefined}>
                <td>
                  <div>${e.name}</div>
                  ${e.notes
                    ? html`<div class="muted" style="font-size:11.5px">${e.notes}</div>`
                    : null}
                </td>
                <td class="muted">${e.type}</td>
                <td class="muted">${e.owner || "—"}</td>
                <td class="muted">${e.collected_date ?? "—"}</td>
                <td>
                  <span class="pill" style=${`background:${f.colour}1a;color:${f.colour}`}>
                    ${f.label}${e.age_days == null ? "" : ` · ${e.age_days}d`}
                  </span>
                </td>
                <td class="muted">${e.control_ids.length || "—"}</td>
                <td onClick=${(ev: Event) => ev.stopPropagation()}>
                  <${FileCell} evidence=${e} canEdit=${canEdit} onChanged=${reload} />
                <//>
              </tr>`;
          })}
        </tbody>
      </table>

      ${shown.length === 0
        ? html`<p class="muted" style="padding:16px 4px">No evidence matches those filters.</p>`
        : null}
    </div>

    ${draft
      ? html`<${Modal}
          title=${editing ? "Evidence" : "Add evidence"}
          submitLabel=${editing ? "Save changes" : "Add evidence"}
          busy=${busy}
          error=${formError}
          onClose=${close}
          onSubmit=${submit}
          onDelete=${editing ? remove : undefined}
        >
          <div class="form-grid">
            <${Field} label="Name" wide=${true}>
              <input required maxLength=${300} value=${draft.name}
                     onInput=${(e: Event) => set({ name: (e.target as HTMLInputElement).value })} />
            <//>
            <${Field} label="Type">
              <select value=${draft.type}
                      onChange=${(e: Event) => set({ type: (e.target as HTMLSelectElement).value })}>
                ${TYPES.map((t) => html`<option value=${t}>${t}</option>`)}
              </select>
            <//>
            <${Field} label="Owner">
              <input value=${draft.owner ?? ""}
                     onInput=${(e: Event) => set({ owner: (e.target as HTMLInputElement).value })} />
            <//>
            <${Field} label="Collected" hint="drives the freshness badge">
              <input type="date" data-fix="collected" value=${draft.collectedDate ?? ""}
                     onInput=${(e: Event) => {
                       const v = (e.target as HTMLInputElement).value;
                       set({ collectedDate: v === "" ? null : v });
                     }} />
            <//>
            <${Field} label="Next review"
                      hint=${draft.ownerEmail
                        ? "A reminder goes out three days before, on the day, and while it stays overdue."
                        : "Add an email below and this date starts chasing somebody."}>
              <input type="date" value=${draft.nextReview ?? ""}
                     onInput=${(e: Event) => {
                       const v = (e.target as HTMLInputElement).value;
                       set({ nextReview: v === "" ? null : v });
                     }} />
            <//>
            ${/*
                Beside the review date rather than beside the owner's name, so
                the pair that actually does something sits together. A name with
                no address chases nobody, and an address with no date is silent.
            */ null}
            <${Field} label="Email reminders to"
                      hint="Leave blank and nothing is sent.">
              <input type="email" placeholder="name@yourcompany.com"
                     value=${draft.ownerEmail ?? ""}
                     onInput=${(e: Event) =>
                       set({ ownerEmail: (e.target as HTMLInputElement).value })} />
            <//>
            <${Field} label="Notes" wide=${true}>
              <textarea rows="2" value=${draft.notes ?? ""}
                        onInput=${(e: Event) => set({ notes: (e.target as HTMLTextAreaElement).value })}></textarea>
            <//>

            <${Field} label=${`Proves which ${plural(itemLabel).toLowerCase()}`} wide=${true}
                      hint="Evidence with nothing linked is what shows up as a gap on the dashboard.">
              <div class="link-picker">
                ${(draft.controlIds ?? []).map((id) => {
                  const c = byRef.get(id);
                  return html`
                    <button type="button" class="chip" onClick=${() => toggleLink(id)}
                            title="Remove this link">
                      ${c ? c.ref : id.slice(0, 8)} ×
                    </button>`;
                })}
                <select value="" onChange=${(e: Event) => {
                  const select = e.target as HTMLSelectElement;
                  if (select.value) toggleLink(select.value);
                  select.value = "";
                }}>
                  <option value="">Add a link…</option>
                  ${catalogue
                    .filter((c) => !(draft.controlIds ?? []).includes(c.id))
                    .map((c) => html`<option value=${c.id}>${c.ref} — ${c.title.slice(0, 70)}</option>`)}
                </select>
              </div>
            <//>
          </div>
        <//>`
      : null}
  </>`;
}
