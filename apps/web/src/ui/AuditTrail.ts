import { useEffect, useRef, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import {
  auditTrail, type AuditChoices, type AuditEntry, type AuditFilters,
} from "../persistence/apiClient.js";

/**
 * The audit trail: every change, sign-in and administrative action, newest
 * first, for administrators and auditors.
 *
 * Read only, and it says so. An auditor's first question about a trail is
 * whether anybody can edit it, and the answer belongs on the screen rather
 * than in a manual.
 */

const RECORD: Record<string, string> = {
  user: "User",
  settings: "Settings",
  evidence: "Evidence",
  backup: "Backup",
  risk: "Risk",
  programme: "Programme",
  demo: "Example data",
  update: "Update",
  report: "Report",
  journey_task: "Get ready step",
  audit: "Audit trail",
};

const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });

/** "2026-09-22" in the reader's own time zone, as the instant that day starts. */
const dayStart = (day: string, plusDays = 0): string => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d! + plusDays).toISOString();
};

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.length === 0) return "—";
  return JSON.stringify(v);
};

const clip = (s: string, n = 160): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Field names as written in the database, made readable: "due_date" → "Due date". */
const fieldName = (f: string): string => {
  const words = f.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function recordType(e: AuditEntry, itemLabel: string): string {
  if (!e.entity) return "";
  if (e.entity === "control") return itemLabel;
  return RECORD[e.entity] ?? fieldName(e.entity);
}

/** The values an added or deleted record had, when there is no before and after to compare. */
function Values({ value }: { value: unknown }): VNode {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rows = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0),
    );
    return html`<table class="audit-values">
      <tbody>
        ${rows.map(([k, v]) => html`<tr><th>${fieldName(k)}</th><td>${clip(show(v), 400)}</td></tr>`)}
      </tbody>
    </table>`;
  }
  return html`<div>${clip(show(value), 400)}</div>`;
}

function Detail({ e }: { e: AuditEntry }): VNode {
  return html`<div class="audit-detail">
    ${e.changes.length
      ? html`<table class="audit-values">
          <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
          <tbody>
            ${e.changes.map((c) => html`<tr>
              <th>${fieldName(c.field)}</th>
              <td>${clip(show(c.from), 400)}</td>
              <td>${clip(show(c.to), 400)}</td>
            </tr>`)}
          </tbody>
        </table>`
      : e.after !== null
      ? html`<div class="muted audit-cap">Recorded</div><${Values} value=${e.after} />`
      : e.before !== null
      ? html`<div class="muted audit-cap">As it was</div><${Values} value=${e.before} />`
      : html`<div class="muted">Nothing more was recorded for this entry.</div>`}
    <div class="muted audit-meta">
      Entry ${e.id}${e.entityId ? ` · record ${e.entityId}` : ""} · ${e.ts} (UTC)
    </div>
  </div>`;
}

/**
 * Who to show for an entry.
 *
 * The log stores "anonymous" for anything done before somebody signed in, and
 * the first thing every install shows is one of those - creating the first
 * administrator - which reads as an intruder. The stored word is left alone
 * (the log is never rewritten); only what is displayed changes.
 */
function who(person: string, action: string): string {
  if (person !== "anonymous") return person;
  return action === "Bootstrap admin created" ? "Installer" : "Unknown user";
}

export function AuditTrail({ itemLabel }: { itemLabel: string }): VNode {
  const [q, setQ] = useState("");
  const [person, setPerson] = useState("");
  const [action, setAction] = useState("");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [choices, setChoices] = useState<AuditChoices | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The typed search waits for a pause before asking the server.
  const [typed, setTyped] = useState("");
  const timer = useRef<number | undefined>(undefined);

  const filters: AuditFilters = {
    q: q.trim() || undefined,
    person: person || undefined,
    action: action || undefined,
    from: fromDay ? dayStart(fromDay) : undefined,
    to: toDay ? dayStart(toDay, 1) : undefined,
  };
  const key = JSON.stringify(filters);

  useEffect(() => {
    auditTrail.choices().then(setChoices).catch(() => { /* the filters still work typed */ });
  }, []);

  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    auditTrail
      .list(filters)
      .then((r) => {
        if (!live) return;
        setEntries(r.entries);
        setNext(r.next);
        setTotal(r.total ?? r.entries.length);
        setOpen(null);
      })
      .catch((err: Error) => live && setError(err.message))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [key]);

  const more = async (): Promise<void> => {
    if (!next) return;
    setBusy(true);
    try {
      const r = await auditTrail.list(filters, next);
      setEntries((was) => [...(was ?? []), ...r.entries]);
      setNext(r.next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onType = (value: string): void => {
    setTyped(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setQ(value), 300);
  };

  const filtered = Boolean(q || person || action || fromDay || toDay);
  const clear = (): void => {
    setTyped(""); setQ(""); setPerson(""); setAction(""); setFromDay(""); setToDay("");
  };

  return html`<>
    <div class="card pad">
      <div class="notice audit-notice">
        <b>Read only.</b> Nothing on this screen, or anywhere in the product, can change
        or delete an entry.
        ${choices
          ? choices.retentionDays > 0
            ? ` Entries older than ${choices.retentionDays} days are removed each night, as set by whoever runs the server.`
            : " Entries are kept for ever."
          : ""}
      </div>

      <div class="toolbar">
        <input type="search" placeholder="Search actions, people, records, addresses…"
          value=${typed} onInput=${(e: Event) => onType((e.target as HTMLInputElement).value)} />
        <select value=${person} onChange=${(e: Event) => setPerson((e.target as HTMLSelectElement).value)}>
          <option value="">Everyone</option>
          ${(choices?.people ?? []).map((p) => html`<option value=${p}>${p === "anonymous" ? "Unknown user" : p}</option>`)}
        </select>
        <select value=${action} onChange=${(e: Event) => setAction((e.target as HTMLSelectElement).value)}>
          <option value="">All actions</option>
          ${(choices?.actions ?? []).map((a) => html`<option value=${a}>${a}</option>`)}
        </select>
      </div>
      <div class="toolbar">
        <label class="audit-date">From
          <input type="date" value=${fromDay} max=${toDay || undefined}
            onChange=${(e: Event) => setFromDay((e.target as HTMLInputElement).value)} />
        </label>
        <label class="audit-date">To
          <input type="date" value=${toDay} min=${fromDay || undefined}
            onChange=${(e: Event) => setToDay((e.target as HTMLInputElement).value)} />
        </label>
        ${filtered ? html`<button type="button" class="btn small ghost" onClick=${clear}>Clear filters</button>` : null}
        <a class="btn small" href=${auditTrail.exportUrl(filters)}
           title="Everything that matches the filters, as a spreadsheet">Download CSV</a>
        <div class="toolbar-note muted">
          ${entries === null ? "" : `${total.toLocaleString()} ${total === 1 ? "entry" : "entries"}${filtered ? " match" : ""}`}
        </div>
      </div>

      ${error ? html`<div class="err">${error}</div>` : null}

      ${entries === null
        ? html`<p class="muted">Loading…</p>`
        : entries.length === 0
        ? html`<p class="muted">${filtered ? "Nothing matches these filters." : "Nothing has been recorded yet."}</p>`
        : html`<table class="audit-table">
            <thead>
              <tr>
                <th style="width:190px">When</th>
                <th style="width:150px">Who</th>
                <th>What happened</th>
                <th>Record</th>
                <th style="width:130px">From</th>
              </tr>
            </thead>
            <tbody>
              ${entries.map((e) => html`
                <tr key=${e.id} class=${`clickable${open === e.id ? " open" : ""}`}
                    onClick=${() => setOpen(open === e.id ? null : e.id)}>
                  <td>${when(e.ts)}</td>
                  <td>${who(e.person, e.action)}</td>
                  <td>
                    <div>${e.action}</div>
                    ${e.changes.length
                      ? html`<div class="muted audit-sub">
                          ${clip(e.changes.map((c) => fieldName(c.field)).join(", "), 90)}
                        </div>`
                      : null}
                  </td>
                  <td>
                    ${e.entity ? html`<div class="muted audit-sub">${recordType(e, itemLabel)}</div>` : null}
                    <div>${clip(e.label ?? e.entityId ?? "", 80)}</div>
                  </td>
                  <td class="muted">${e.ip ?? ""}</td>
                </tr>
                ${open === e.id
                  ? html`<tr key=${`${e.id}-d`} class="audit-open-row"><td colspan="5"><${Detail} e=${e} /></td></tr>`
                  : null}`)}
            </tbody>
          </table>
          ${next
            ? html`<div class="form-actions">
                <button type="button" class="btn" disabled=${busy} onClick=${() => void more()}>
                  ${busy ? "Loading…" : "Show older entries"}
                </button>
              </div>`
            : null}`}
    </div>
  </>`;
}
