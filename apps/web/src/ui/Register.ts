import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { toCsv, download, parseCsv, key as headerKey } from "./csv.js";
import { Modal, Field } from "./Modal.js";
import type { RegisterApi, RegisterRow, PolicyAcknowledgement, Attachment } from "../persistence/apiClient.js";
import { attachments as attachmentsApi } from "../persistence/apiClient.js";
import { policyAcknowledgements } from "../persistence/apiClient.js";
import { since } from "./format.js";

/**
 * A register screen: toolbar, table, add/edit dialog.
 *
 * The five Phase 3 registers differ only in their columns and their form
 * fields, so those are configuration and the behaviour — optimistic reload,
 * error handling, delete, filtering, search — is written once. Controls,
 * evidence and risks keep their own components, because each has a chart or a
 * bespoke interaction that does not generalise.
 */

export type FieldKind =
  | "text" | "textarea" | "date" | "select" | "links" | "link" | "history"
  | "acknowledgements";

/**
 * Field kinds that display server-derived data and are never sent back. The
 * API rejects unknown keys, so anything shown but not writable has to be
 * stripped before the request goes out.
 */
const READ_ONLY: ReadonlySet<FieldKind> = new Set<FieldKind>(["history", "acknowledgements"]);

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  /** For "links" / "link": which pick list to offer. */
  source?: string;
  wide?: boolean;
  hint?: string;
  required?: boolean;
}

export interface ColumnSpec<T> {
  header: string;
  width?: string;
  align?: "right";
  cell: (row: T) => VNode | string | number;
}

/** An option in a link picker: an id plus how to show it. */
export interface LinkOption {
  id: string;
  label: string;
  detail?: string;
}

export interface RegisterSpec<T extends RegisterRow> {
  api: RegisterApi<T>;
  singular: string;
  plural: string;
  columns: ColumnSpec<T>[];
  fields: FieldSpec[];
  blank: () => Record<string, unknown>;
  toInput: (row: T) => Record<string, unknown>;
  /** Everything the search box should match against. */
  searchText: (row: T) => string;
  /** Toolbar dropdowns, filtering on an exact row value. */
  filters?: { key: keyof T & string; label: string; options: readonly string[] }[];
  /** Optional summary card above the table. */
  summary?: (rows: T[]) => VNode;
  /** Checks before the request goes out. Return a message to block it. */
  validate?: (draft: Record<string, unknown>) => string | null;
  /**
   * Set to the register's path to let files be attached to its records, and to
   * show how many each has. The server keeps the list of registers that may.
   */
  attachTo?: string;
}

/**
 * Who has read the policy.
 *
 * Separate from the rest of the form on purpose. Everything else in the dialog
 * is a draft that lands when somebody presses Save; an acknowledgement is a
 * statement about a named person and is written the moment it is recorded, so
 * closing the dialog without saving cannot lose one.
 *
 * It records the version saved on the policy, not the one in the box above,
 * which may be a change nobody has saved yet.
 */
function Acknowledgements({ policyId, version, entries, canEdit, onChange }: {
  policyId: string | null;
  version: string;
  entries: PolicyAcknowledgement[];
  canEdit: boolean;
  onChange: (next: PolicyAcknowledgement[]) => void;
}): VNode {
  const [person, setPerson] = useState("");
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add(): Promise<void> {
    if (!policyId || !person.trim()) return;
    setBusy(true);
    setError("");
    try {
      const made = await policyAcknowledgements.add(policyId, {
        person: person.trim(),
        acknowledgedOn: on,
      });
      onChange([made, ...entries]);
      setPerson("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function drop(id: string): Promise<void> {
    if (!policyId) return;
    setBusy(true);
    setError("");
    try {
      await policyAcknowledgements.remove(policyId, id);
      onChange(entries.filter((e) => e.id !== id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // A policy nobody has saved yet has no id to hang an acknowledgement on.
  if (!policyId) {
    return html`<p class="muted" style="margin:0;font-size:12px">
      Add the policy first. Once it exists you can record who has read it.
    </p>`;
  }

  return html`<>
    ${entries.length
      ? html`<ul class="history">
          ${entries.map((a) => html`
            <li>
              <b>${a.person}</b>
              <span class="muted">v${a.version}${a.version !== version ? " (earlier version)" : ""}</span>
              <span class="muted">${a.acknowledged_on}</span>
              ${canEdit
                ? html`<button type="button" class="chip" style="margin-left:auto"
                          title="Recorded by mistake? Remove it." disabled=${busy}
                          onClick=${() => void drop(a.id)}>×</button>`
                : null}
            </li>`)}
        </ul>`
      : html`<p class="muted" style="margin:0;font-size:12px">
          Nobody has acknowledged this yet.
        </p>`}
    ${canEdit
      ? html`<div class="ack-add">
          <input placeholder="Who has read it" value=${person} maxLength=${200}
                 onInput=${(e: Event) => setPerson((e.target as HTMLInputElement).value)} />
          <input type="date" value=${on}
                 onInput=${(e: Event) => setOn((e.target as HTMLInputElement).value)} />
          <button type="button" class="btn small" disabled=${busy || !person.trim()}
                  onClick=${() => void add()}>
            ${busy ? "Recording…" : version ? `Record against v${version}` : "Record"}
          </button>
        </div>`
      : null}
    ${error ? html`<div class="err" role="alert">${error}</div>` : null}
  </>`;
}

/**
 * What a link field says when there is nothing to link to yet, instead of an
 * "Add a link" list with nothing in it, which looked broken.
 */
function emptyLinks(source: string | undefined): VNode {
  const text = source === "risks"
    ? html`No risks yet. Add them in <a href="#/risks">Risks</a>, then come back.`
    : source === "controls"
      ? "Loading the list…"
      : "Nothing to link to yet.";
  return html`<div class="muted" style="font-size:12.5px;padding:7px 0">${text}</div>`;
}

/**
 * The files on one record.
 *
 * Like acknowledgements, these are written the moment they are added rather
 * than on Save: a file is a fact about the record, not part of a draft, and
 * closing the dialog without saving must not lose an upload.
 */
function Attachments({ register, recordId, canEdit, onChange }: {
  register: string;
  recordId: string | null;
  canEdit: boolean;
  onChange: () => void;
}): VNode {
  const [files, setFiles] = useState<Attachment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!recordId) return undefined;
    let live = true;
    attachmentsApi.list(register, recordId)
      .then((f) => live && setFiles(f))
      .catch((err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, [register, recordId]);

  if (!recordId) {
    return html`<p class="muted" style="margin:0;font-size:12px">
      Save this first. Once it exists you can attach files to it.
    </p>`;
  }

  async function add(list: FileList | null): Promise<void> {
    if (!list || !recordId) return;
    setBusy(true);
    setError("");
    try {
      const added: Attachment[] = [];
      for (const file of Array.from(list)) added.push(await attachmentsApi.add(register, recordId, file));
      setFiles((f) => [...added, ...(f ?? [])]);
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(a: Attachment): Promise<void> {
    if (!window.confirm(`Remove ${a.name}? The file is deleted.`)) return;
    setBusy(true);
    setError("");
    try {
      await attachmentsApi.remove(a.id);
      setFiles((f) => (f ?? []).filter((x) => x.id !== a.id));
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const size = (n: number): string =>
    n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

  return html`<>
    ${files === null
      ? html`<p class="muted" style="margin:0;font-size:12px">Loading…</p>`
      : files.length
      ? html`<ul class="history">
          ${files.map((a) => html`
            <li>
              <a href=${attachmentsApi.fileUrl(a.id)} download=${a.name}><b>${a.name}</b></a>
              <span class="muted">${size(a.size)}</span>
              <span class="muted">${a.uploadedBy} · ${a.uploadedAt.slice(0, 10)}</span>
              ${canEdit
                ? html`<button type="button" class="chip" style="margin-left:auto" disabled=${busy}
                          title="Remove this file" onClick=${() => void remove(a)}>×</button>`
                : null}
            </li>`)}
        </ul>`
      : html`<p class="muted" style="margin:0;font-size:12px">No files attached yet.</p>`}
    ${canEdit
      ? html`<div class="ack-add">
          <input ref=${input} type="file" multiple style="display:none"
                 onChange=${(e: Event) => void add((e.target as HTMLInputElement).files)} />
          <button type="button" class="btn small" disabled=${busy}
                  onClick=${() => input.current?.click()}>
            ${busy ? "Uploading…" : "Attach a file"}
          </button>
        </div>`
      : null}
    ${error ? html`<div class="err" role="alert">${error}</div>` : null}
  </>`;
}

export function Register<T extends RegisterRow>({ spec, canEdit, links, csv }: {
  spec: RegisterSpec<T>;
  canEdit: boolean;
  links?: Record<string, LinkOption[]>;
  /** Whether this product offers spreadsheet import and export. */
  csv?: boolean;
}): VNode {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  /** The import: a chosen file, what was read from it, and how it went. */
  const [importing, setImporting] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState("");
  /**
   * Import problems are their own state. `error` means the register could not
   * be loaded at all and replaces the screen; a bad spreadsheet must not do
   * that, or somebody loses the table they were looking at.
   */
  const [importError, setImportError] = useState("");
  const importInput = useRef<HTMLInputElement | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});

  const [editing, setEditing] = useState<T | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let live = true;
    spec.api
      .list()
      .then((r) => live && setRows(r))
      .catch((err: Error) => live && setError(err.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [spec.api]);

  const reload = async (): Promise<void> => setRows(await spec.api.list());

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((row) => {
      for (const [key, value] of Object.entries(picked)) {
        if (value && String(row[key] ?? "") !== value) return false;
      }
      return !needle || spec.searchText(row).toLowerCase().includes(needle);
    });
  }, [rows, q, picked, spec]);

  function open(row: T | null): void {
    setEditing(row);
    setDraft(row ? spec.toInput(row) : spec.blank());
    setFormError("");
  }
  const close = (): void => { setEditing(null); setDraft(null); };
  const set = (patch: Record<string, unknown>): void =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    if (!draft) return;

    const complaint = spec.validate?.(draft);
    if (complaint) { setFormError(complaint); return; }

    const readOnly = new Set(spec.fields.filter((f) => READ_ONLY.has(f.kind)).map((f) => f.key));
    const payload = Object.fromEntries(
      Object.entries(draft).filter(([k]) => !readOnly.has(k)),
    );

    setBusy(true);
    setFormError("");
    try {
      if (editing) await spec.api.update(editing.id, payload);
      else await spec.api.create(payload);
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
      await spec.api.remove(editing.id);
      await reload();
      close();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggleLink = (key: string, id: string): void =>
    setDraft((d) => {
      if (!d) return d;
      const current = new Set((d[key] as string[] | undefined) ?? []);
      if (current.has(id)) current.delete(id);
      else current.add(id);
      return { ...d, [key]: [...current] };
    });

  function control(f: FieldSpec, value: unknown): VNode {
    const str = value == null ? "" : String(value);
    switch (f.kind) {
      case "textarea":
        return html`<textarea rows="3" value=${str}
          onInput=${(e: Event) => set({ [f.key]: (e.target as HTMLTextAreaElement).value })}
        ></textarea>`;
      case "date":
        return html`<input type="date" value=${str} onInput=${(e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          set({ [f.key]: v === "" ? null : v });
        }} />`;
      case "select": {
        // A value the list does not hold is offered anyway. Without this, a
        // row whose type came from the sample library or a CSV import loses
        // it the moment somebody opens the row and saves.
        const options = f.options ?? [];
        const choices = str && !options.includes(str) ? [str, ...options] : options;
        return html`<select value=${str}
          onChange=${(e: Event) => set({ [f.key]: (e.target as HTMLSelectElement).value })}>
          ${choices.map((o) => html`<option value=${o}>${o}</option>`)}
        </select>`;
      }
      case "link": {
        const options = links?.[f.source ?? ""] ?? [];
        if (!options.length && !str) return emptyLinks(f.source);
        return html`<select value=${str} onChange=${(e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          set({ [f.key]: v === "" ? null : v });
        }}>
          <option value="">— none —</option>
          ${options.map((o) => html`<option value=${o.id}>${o.label}${o.detail ? ` — ${o.detail}` : ""}</option>`)}
        </select>`;
      }
      case "links": {
        const options = links?.[f.source ?? ""] ?? [];
        const chosen = (value as string[] | undefined) ?? [];
        if (!options.length && !chosen.length) return emptyLinks(f.source);
        const byId = new Map(options.map((o) => [o.id, o]));
        return html`
          <div class="link-picker">
            ${chosen.map((id) => html`
              <button type="button" class="chip" title="Remove this link"
                      onClick=${() => toggleLink(f.key, id)}>
                ${byId.get(id)?.label ?? id.slice(0, 8)} ×
              </button>`)}
            <select value="" onChange=${(e: Event) => {
              const select = e.target as HTMLSelectElement;
              if (select.value) toggleLink(f.key, select.value);
              select.value = "";
            }}>
              <option value="">Add a link…</option>
              ${options.filter((o) => !chosen.includes(o.id)).map((o) => html`
                <option value=${o.id}>${o.label}${o.detail ? ` — ${o.detail}` : ""}</option>`)}
            </select>
          </div>`;
      }
      case "history": {
        const entries = (value as { version: string; status: string; approver: string;
                                    changeNote: string; archivedAt: string }[] | undefined) ?? [];
        if (!entries.length) {
          return html`<p class="muted" style="margin:0;font-size:12px">
            No earlier versions yet. Change the version number and this one is archived here.
          </p>`;
        }
        return html`
          <ul class="history">
            ${entries.map((v) => html`
              <li>
                <b>v${v.version}</b>
                <span class="muted">${v.status}${v.approver ? ` · ${v.approver}` : ""}</span>
                <span class="muted">${(v.archivedAt ?? "").slice(0, 10)}</span>
                ${v.changeNote ? html`<div class="muted">${v.changeNote}</div>` : null}
              </li>`)}
          </ul>`;
      }
      case "acknowledgements": {
        const entries = (value as PolicyAcknowledgement[] | undefined) ?? [];
        return html`<${Acknowledgements}
          policyId=${editing?.id ?? null}
          version=${String(editing?.["version"] ?? "")}
          entries=${entries}
          canEdit=${canEdit}
          onChange=${(next: PolicyAcknowledgement[]) => {
            set({ [f.key]: next });
            void reload();
          }} />`;
      }
      default:
        return html`<input value=${str} required=${f.required ?? false} maxLength=${300}
          onInput=${(e: Event) => set({ [f.key]: (e.target as HTMLInputElement).value })} />`;
    }
  }

  /** The rows on screen, with the columns of the add form: what a person edits. */
  function exportCsv(): void {
    const fields = spec.fields.filter((f) => !READ_ONLY.has(f.kind));
    const headers = fields.map((f) => f.label);
    const body = shown.map((row) => {
      const input = spec.toInput(row);
      return fields.map((f) => {
        const value = input[f.key];
        if (Array.isArray(value)) {
          // Links are ids on the wire and labels to a reader.
          const source = links?.[f.source ?? ""] ?? [];
          return value
            .map((id) => source.find((o) => o.id === id)?.label ?? String(id))
            .join("; ");
        }
        return value ?? "";
      });
    });
    const stamp = new Date().toISOString().slice(0, 10);
    download(`${spec.plural.toLowerCase().replace(/\s+/g, "-")}-${stamp}.csv`, toCsv(headers, body));
  }

  async function readFile(file: File): Promise<void> {
    setImportError("");
    setImportResult("");
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) {
      setImportError("That file has no rows under its headings.");
      return;
    }
    setImporting({ headers: parsed[0]!, rows: parsed.slice(1) });
  }

  /**
   * One row at a time, through the same API and the same validation the form
   * uses. Slower than a bulk endpoint and worth it: a spreadsheet with one bad
   * date imports the other 49 rows and says which one was refused.
   */
  async function runImport(): Promise<void> {
    if (!importing) return;
    setImportBusy(true);
    setImportError("");

    const fields = spec.fields.filter(
      (f) => !READ_ONLY.has(f.kind) && f.kind !== "links" && f.kind !== "link",
    );
    const byHeader = new Map(importing.headers.map((h, i) => [headerKey(h), i]));
    const wanted = fields
      .map((f) => ({ field: f, at: byHeader.get(headerKey(f.label)) ?? byHeader.get(headerKey(f.key)) }))
      .filter((x): x is { field: FieldSpec; at: number } => x.at !== undefined);

    // A missing required column would refuse every row with the same message,
    // so say it once, before anything is sent, and name the heading to add.
    const missing = fields.filter((f) => f.required && !wanted.some((w) => w.field.key === f.key));
    if (missing.length) {
      setImportBusy(false);
      setImporting(null);
      setImportError(
        `Nothing was added: the file has no column for ${missing.map((f) => `"${f.label}"`).join(" or ")}. ` +
          "Rename the heading to match and try again. Export a CSV first to see the headings this screen expects.",
      );
      return;
    }

    let added = 0;
    const failures: string[] = [];

    for (const [i, row] of importing.rows.entries()) {
      const draft: Record<string, unknown> = { ...spec.blank() };
      for (const { field, at } of wanted) {
        const raw = (row[at] ?? "").trim();
        if (raw === "") continue;
        draft[field.key] = field.kind === "date" ? raw : raw;
      }
      const complaint = spec.validate?.(draft);
      if (complaint) {
        failures.push(`row ${i + 2}: ${complaint}`);
        continue;
      }
      try {
        await spec.api.create(draft);
        added++;
      } catch (err) {
        // The server's detail says which field it disliked; the message alone
        // is "Invalid request.", which helps nobody fix a spreadsheet.
        const detail = (err as { detail?: unknown }).detail;
        const why = Array.isArray(detail)
          ? detail
              .map((d) => (typeof d === "object" && d ? `${(d as { path?: string }).path}: ${(d as { message?: string }).message}` : String(d)))
              .join(", ")
          : (err as Error).message;
        failures.push(`row ${i + 2}: ${why}`);
      }
    }

    setImportBusy(false);
    setImporting(null);
    setImportResult(
      `${added} added` +
        (failures.length ? `, ${failures.length} refused. ${failures.slice(0, 3).join("; ")}` : "."),
    );
    await reload();
  }
  if (loading) return html`<div class="card pad muted">Loading…</div>`;
  if (error) return html`<div class="card pad err">${error}</div>`;

  return html`<>
    ${spec.summary ? spec.summary(shown) : null}

    <div class="card pad">
      <div class="toolbar">
        <input type="search" placeholder=${`Search ${spec.plural.toLowerCase()}…`} value=${q}
               onInput=${(e: Event) => setQ((e.target as HTMLInputElement).value)} />
        ${(spec.filters ?? []).map((f) => html`
          <select value=${picked[f.key] ?? ""}
                  onChange=${(e: Event) =>
                    setPicked((p) => ({ ...p, [f.key]: (e.target as HTMLSelectElement).value }))}>
            <option value="">${f.label}</option>
            ${f.options.map((o) => html`<option value=${o}>${o}</option>`)}
          </select>`)}
        <div class="toolbar-note muted">${shown.length} of ${rows.length}</div>
        ${csv
          ? html`<button type="button" class="btn" onClick=${exportCsv}
                   title="The rows shown, as a spreadsheet">Export CSV</button>`
          : null}
        ${csv && canEdit
          ? html`<>
              <button type="button" class="btn" onClick=${() => importInput.current?.click()}>
                Import CSV
              </button>
              <input ref=${importInput} type="file" accept=".csv,text/csv" style="display:none"
                onChange=${(e: Event) => {
                  const input = e.target as HTMLInputElement;
                  const file = input.files?.[0];
                  input.value = "";
                  if (file) void readFile(file);
                }} />
            </>`
          : null}
        ${canEdit
          ? html`<button class="btn primary" onClick=${() => open(null)}>Add ${spec.singular.toLowerCase()}</button>`
          : null}
      </div>

      ${importError ? html`<div class="err" role="alert">${importError}</div>` : null}
      ${importResult ? html`<div class="ok-note" role="status">${importResult}</div>` : null}

      ${importing
        ? html`<div class="confirm">
            <div><b>${importing.rows.length} row${importing.rows.length === 1 ? "" : "s"} in that file.</b></div>
            <div class="muted" style="margin-top:4px">
              Columns matched by heading: ${importing.headers
                .filter((h) => spec.fields.some((f) => headerKey(f.label) === headerKey(h) || headerKey(f.key) === headerKey(h)))
                .join(", ") || "none"}.
              Anything else in the file is ignored, and nothing already here is changed.
            </div>
            <div class="confirm-actions">
              <button type="button" class="btn small" disabled=${importBusy}
                onClick=${() => setImporting(null)}>Cancel</button>
              <button type="button" class="btn small primary" disabled=${importBusy}
                onClick=${() => void runImport()}>
                ${importBusy ? "Adding…" : `Add ${importing.rows.length} to ${spec.plural.toLowerCase()}`}
              </button>
            </div>
          </div>`
        : null}

      <table>
        <thead>
          <tr>
            <th style="width:52px">#</th>
            ${spec.columns.map((c) => html`
              <th style=${`${c.width ? `width:${c.width};` : ""}${c.align === "right" ? "text-align:right" : ""}`}>
                ${c.header}
              </th>`)}
            ${spec.attachTo ? html`<th style="width:70px">Files</th>` : null}
            <th style="width:100px">Updated</th>
          </tr>
        </thead>
        <tbody>
          ${shown.map((row) => html`
            <tr key=${row.id} class=${canEdit ? "clickable" : ""}
                onClick=${canEdit ? () => open(row) : undefined}>
              <td class="muted">${row.seq}</td>
              ${spec.columns.map((c) => html`
                <td style=${c.align === "right" ? "text-align:right" : ""}>${c.cell(row)}</td>`)}
              ${spec.attachTo
                ? html`<td class=${Number(row["attachment_count"] ?? 0) ? "" : "muted"}
                          title=${Number(row["attachment_count"] ?? 0) ? "Files attached" : "No files attached"}>
                    ${Number(row["attachment_count"] ?? 0) ? `\u{1F4CE} ${row["attachment_count"]}` : "—"}
                  </td>`
                : null}
              <td class="muted">${since(row.updated_at)}</td>
            </tr>`)}
        </tbody>
      </table>

      ${shown.length === 0
        ? html`<p class="muted" style="padding:16px 4px">
            ${rows.length ? "Nothing matches those filters." : `No ${spec.plural.toLowerCase()} recorded yet.`}
          </p>`
        : null}
    </div>

    ${draft
      ? html`<${Modal}
          title=${editing ? `${spec.singular} ${editing.seq}` : `Add ${spec.singular.toLowerCase()}`}
          submitLabel=${editing ? "Save changes" : `Add ${spec.singular.toLowerCase()}`}
          busy=${busy}
          error=${formError}
          onClose=${close}
          onSubmit=${submit}
          onDelete=${editing ? remove : undefined}
        >
          <div class="form-grid">
            ${spec.fields.map((f) => html`
              <${Field} label=${f.label} hint=${f.hint} wide=${f.wide ?? false}>
                ${control(f, draft[f.key])}
              <//>`)}
            ${spec.attachTo
              ? html`<${Field} label="Attached files" wide=${true}
                        hint="PDF, Word, Excel or anything else that proves this record. Saved straight away.">
                  <${Attachments} register=${spec.attachTo} recordId=${editing?.id ?? null}
                                  canEdit=${canEdit} onChange=${() => void reload()} />
                <//>`
              : null}
          </div>
        <//>`
      : null}
  </>`;
}
