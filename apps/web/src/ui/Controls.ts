import { useEffect, useMemo, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { SummaryBand, type Slice } from "./pageParts.js";
import { controls, type Control, type ControlStatus, type Pack } from "../persistence/apiClient.js";
import { ControlDetail } from "./ControlDetail.js";
import type { FixTarget } from "./ControlFix.js";
import { useTarget, settle, goBack, takeStatusFilter, type Target } from "./deepLink.js";
import {
  STATUS_ORDER, STATUS_LABEL, STATUS_PILL, MATURITY_LEVELS, maturityColour,
  themeColor, since, pct, plural,
} from "./format.js";

/**
 * The controls register — the screen people actually spend their day in.
 *
 * Status and owner are edited in place. Each row updates optimistically and
 * rolls back if the server refuses, so the table never sits waiting on a
 * round trip.
 */
/** SAMA's expected floor. A control with no target of its own uses it. */
const DEFAULT_TARGET = 3;

/**
 * Red once a due date has passed, amber as it approaches, plain otherwise.
 *
 * Compared as strings, which works because these are ISO dates and nothing
 * else: a date column that sorted or compared wrongly would be worse than no
 * colour at all.
 */
function dueClass(due: string | null): string {
  if (!due) return "muted";
  const today = new Date().toISOString().slice(0, 10);
  if (due < today) return "due overdue";
  const soon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  return due <= soon ? "due soon" : "due";
}

/**
 * One subdomain's maturity, and the level it is aiming at.
 *
 * Both are on the row rather than behind a dialog, because scoring a
 * framework means going down a list making the same judgement thirty-two
 * times, and a dialog for each would make that miserable.
 *
 * The colour is the whole point of the cell: below target is red whatever
 * the number, so a page of scores reads at a glance.
 */
function MaturityCell({
  control: c,
  canEdit,
  save,
}: {
  control: Control;
  canEdit: boolean;
  save: (id: string, patch: Partial<Control>) => Promise<void>;
}): VNode {
  const target = c.target_maturity ?? DEFAULT_TARGET;
  const colour = maturityColour(c.maturity, target);
  const current = MATURITY_LEVELS.find((l) => l.level === c.maturity);

  // Excluded items are out of every figure, so showing them a level to change
  // would be offering an edit that changes nothing. Open the subdomain to put
  // it back in scope.
  if (c.status === "not_applicable") {
    return html`<span class="pill slate" title="Open it to put it back in scope">
      Does not apply
    </span>`;
  }

  if (!canEdit) {
    return html`<span class="pill" style=${`background:${colour}1a;color:${colour}`}>
      ${c.maturity === null ? "Not scored" : `${c.maturity} · ${current?.name}`}
    </span>`;
  }

  return html`<div class="maturity-cell">
    <select
      class="maturity-select"
      style=${`border-color:${colour};color:${colour}`}
      value=${c.maturity === null ? "" : String(c.maturity)}
      title=${current ? current.note : "not scored yet"}
      onChange=${(e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        void save(c.id, { maturity: v === "" ? null : Number(v) });
      }}
    >
      <option value="">Not scored</option>
      ${MATURITY_LEVELS.map(
        (l) => html`<option value=${String(l.level)}>${l.level} · ${l.name}</option>`,
      )}
    </select>
    <span class="maturity-target muted" title="the level this one is aiming at">
      target
      <select
        value=${String(target)}
        onChange=${(e: Event) =>
          void save(c.id, { target_maturity: Number((e.target as HTMLSelectElement).value) })}
      >
        ${MATURITY_LEVELS.map((l) => html`<option value=${String(l.level)}>${l.level}</option>`)}
      </select>
    </span>
  </div>`;
}

export function Controls({ themes, themeLabel, itemLabel, canEdit, pack }: {
  themes: Record<string, string>;
  themeLabel: string;
  itemLabel: string;
  canEdit: boolean;
  pack: Pack;
}): VNode {
  const [detail, setDetail] = useState<Control | null>(null);
  // Opened from a link such as the Golden thread's fix buttons.
  const target = useTarget("controls");
  const [opened, setOpened] = useState<Target | null>(null);
  const scoresMaturity = Boolean(pack.features?.["maturity"]);
  const [rows, setRows] = useState<Control[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const [q, setQ] = useState("");
  const [theme, setTheme] = useState("");
  // A status chosen on the Dashboard, handed over once.
  const [status, setStatus] = useState(takeStatusFilter);
  useEffect(() => {
    let live = true;
    controls
      .list()
      .then((r) => live && setRows(r.controls))
      .catch((err: Error) => live && setError(err.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!target || !rows.length) return;
    const row = rows.find((c) => c.id === target.id || c.ref === target.id);
    settle("controls");
    if (!row) { setError(`That ${itemLabel.toLowerCase()} is no longer in the register.`); return; }
    setOpened(target);
    setDetail(row);
  }, [target, rows]);

  /** Filtering stays in the browser: 106 rows, and it keeps typing instant. */
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (c) =>
        (!theme || c.theme === theme) &&
        // The same control filters two different things. For a ticked
        // framework it is the status; for a scored one it is the level, plus
        // the two questions somebody actually asks of a maturity programme:
        // what has nobody looked at, and what is short of its target.
        (!status ||
          (status === "todo" && (c.status === "in_progress" || c.status === "not_started")) ||
          (scoresMaturity
            ? status === "excluded"
              ? c.status === "not_applicable"
              : c.status === "not_applicable"
                ? false
                : status === "unscored"
                  ? c.maturity === null
                  : status === "below"
                    ? c.maturity !== null && c.maturity < (c.target_maturity ?? DEFAULT_TARGET)
                    : c.maturity === Number(status.replace("level:", ""))
            : c.status === status)) &&
        (!needle ||
          c.ref.toLowerCase().includes(needle) ||
          c.title.toLowerCase().includes(needle) ||
          c.owner.toLowerCase().includes(needle)),
    );
  }, [rows, q, theme, status, scoresMaturity]);

  async function save(id: string, patch: Partial<Control>): Promise<void> {
    const before = rows.find((c) => c.id === id);
    if (!before) return;

    setRows((current) => current.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setSaving((s) => ({ ...s, [id]: true }));
    try {
      const { control } = await controls.update(id, patch);
      // The count is not on a single control, so keep the one the list had.
      setRows((current) => current.map((c) => (c.id === id ? { ...control, evidence_count: c.evidence_count } : c)));
      setError("");
    } catch (err) {
      // Put the row back the way the server still believes it is.
      setRows((current) => current.map((c) => (c.id === id ? before : c)));
      setError((err as Error).message);
    } finally {
      setSaving((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
    }
  }

  if (loading) return html`<div class="card pad muted">Loading…</div>`;

  const implemented = shown.filter((c) => c.status === "implemented").length;
  const applicable = shown.filter((c) => c.status !== "not_applicable").length;
  const atTarget = shown.filter(
    (c) =>
      c.status !== "not_applicable" &&
      c.maturity !== null &&
      c.maturity >= (c.target_maturity ?? DEFAULT_TARGET),
  ).length;
  const excluded = shown.filter((c) => c.status === "not_applicable").length;

  /** The whole register, not just the filtered rows: the band says where the programme stands. */
  const countOf = (st: ControlStatus): number => rows.filter((c) => c.status === st).length;
  const inScope = rows.filter((c) => c.status !== "not_applicable");
  const noOwner = inScope.filter((c) => !c.owner.trim()).length;
  const pick = (st: string) => (): void => setStatus(status === st ? "" : st);
  const band = scoresMaturity ? null : html`<${SummaryBand}
    lead=${html`<b>${countOf("implemented")} of ${inScope.length}</b>${plural(itemLabel).toLowerCase()} in scope are in place<small>${pct(countOf("implemented"), inScope.length)}%</small>`}
    slices=${[
      { label: STATUS_LABEL.implemented, value: countOf("implemented"), tone: "good", on: status === "implemented", onPick: pick("implemented") },
      { label: STATUS_LABEL.in_progress, value: countOf("in_progress"), tone: "warn", on: status === "in_progress", onPick: pick("in_progress") },
      { label: STATUS_LABEL.not_started, value: countOf("not_started"), tone: "none", on: status === "not_started", onPick: pick("not_started") },
      { label: STATUS_LABEL.not_applicable, value: countOf("not_applicable"), tone: "mute", outside: true,
        on: status === "not_applicable", onPick: pick("not_applicable") },
    ] as Slice[]}
    note=${noOwner ? html`<span style="color:var(--amber-ink)">${noOwner} in scope with no owner</span>` : "Every one in scope has an owner"} />`;

  return html`<>
    ${band}
    <div class="card pad">
      <div class="toolbar">
        <input
          type="search"
          placeholder=${`Search ${plural(itemLabel).toLowerCase()}…`}
          value=${q}
          onInput=${(e: Event) => setQ((e.target as HTMLInputElement).value)}
        />
        <select value=${theme} onChange=${(e: Event) => setTheme((e.target as HTMLSelectElement).value)}>
          <option value="">All ${plural(themeLabel).toLowerCase()}</option>
          ${Object.entries(themes).map(([k, label]) => html`<option value=${k}>${label}</option>`)}
        </select>
        ${scoresMaturity
          ? html`<select value=${status}
                         onChange=${(e: Event) => setStatus((e.target as HTMLSelectElement).value)}>
              <option value="">All levels</option>
              <option value="unscored">Not scored</option>
              <option value="below">Below target</option>
              <option value="excluded">Does not apply</option>
              ${MATURITY_LEVELS.map(
                (l) => html`<option value=${`level:${l.level}`}>Level ${l.level} · ${l.name}</option>`,
              )}
            </select>`
          : html`<select value=${status}
                         onChange=${(e: Event) => setStatus((e.target as HTMLSelectElement).value)}>
              <option value="">All statuses</option>
              <option value="todo">Still to finish</option>
              ${STATUS_ORDER.map((s) => html`<option value=${s}>${STATUS_LABEL[s]}</option>`)}
            </select>`}
        <div class="toolbar-note muted">
          ${scoresMaturity
            ? `${shown.length} of ${rows.length} · ${atTarget} at target or better` +
              (excluded ? ` · ${excluded} excluded` : "")
            : `${shown.length} of ${rows.length} · ${pct(implemented, applicable)}% implemented`}
        </div>
      </div>

      ${error ? html`<div class="err" role="alert">${error}</div>` : null}

      <table>
        <thead>
          <tr>
            <th style="width:86px">Ref</th>
            <th>${itemLabel}</th>
            <th style="width:156px">${scoresMaturity ? "Maturity" : "Status"}</th>
            <th style="width:156px">Owner</th>
            <th style="width:92px">Due</th>
            <th style="width:84px">Evidence</th>
            <th style="width:86px">Updated</th>
          </tr>
        </thead>
        <tbody>
          ${shown.map((c) => html`
            <tr key=${c.id} class=${saving[c.id] ? "saving" : ""}>
              <td>
                <span class="ref" style=${`border-color:${themeColor(c.theme)};color:${themeColor(c.theme)}`}>
                  ${c.ref}
                </span>
              </td>
              <td class="clickable" onClick=${() => setDetail(c)}
                  title="Open the full record">
                <div>${c.title}</div>
                <div class="muted" style="font-size:11.5px">
                  ${themes[c.theme] ?? c.theme}
                  ${c.attrs["priority"] ? ` · ${String(c.attrs["priority"])} priority` : ""}
                </div>
              </td>
              <td>
                ${scoresMaturity
                  ? html`<${MaturityCell} control=${c} canEdit=${canEdit} save=${save} />`
                  : canEdit
                    ? html`<select
                        class=${`status-select ${STATUS_PILL[c.status]}`}
                        value=${c.status}
                        onChange=${(e: Event) =>
                          void save(c.id, { status: (e.target as HTMLSelectElement).value as ControlStatus })}
                      >
                        ${STATUS_ORDER.map((s) => html`<option value=${s}>${STATUS_LABEL[s]}</option>`)}
                      </select>`
                    : html`<span class=${`pill ${STATUS_PILL[c.status]}`}>${STATUS_LABEL[c.status]}</span>`}
              </td>
              <td>
                ${canEdit
                  ? html`<input
                      class="owner-input"
                      placeholder="Unassigned"
                      value=${c.owner}
                      onBlur=${(e: Event) => {
                        const value = (e.target as HTMLInputElement).value;
                        if (value !== c.owner) void save(c.id, { owner: value });
                      }}
                      onKeyDown=${(e: KeyboardEvent) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                    />`
                  : html`<span class="muted">${c.owner || "—"}</span>`}
              </td>
              ${/*
                  Read-only here on purpose. A date and an address together make
                  the product email somebody, and that decision belongs on the
                  control where both fields sit side by side with an explanation,
                  not behind a quick inline edit in a list of 183 rows.
              */ null}
              <td class=${dueClass(c.due_date)} title=${c.owner_email ? `Reminders to ${c.owner_email}` : "No reminder address set"}>
                ${c.due_date ? html`<>${c.due_date}${c.owner_email ? "" : html` <span class="muted">·no email</span>`}</>` : html`<span class="muted">—</span>`}
              </td>
              <td class=${(c.evidence_count ?? 0) ? "" : "muted"}
                  title=${(c.evidence_count ?? 0) ? "Evidence items linked to this control" : "No evidence linked yet"}>
                ${(c.evidence_count ?? 0) ? html`<span class="pill green">Yes \u00b7 ${c.evidence_count}</span>` : "No"}
              </td>
              <td class="muted">${since(c.updated_at)}</td>
            </tr>`)}
        </tbody>
      </table>

      ${shown.length === 0
        ? html`<p class="muted" style="padding:16px 4px">Nothing matches those filters.</p>`
        : null}
    </div>

    ${detail
      ? html`<${ControlDetail}
          control=${detail}
          pack=${pack}
          canEdit=${canEdit}
          initialFix=${(opened?.fix ?? "") as FixTarget | ""}
          onClose=${() => {
            setDetail(null);
            const from = opened;
            setOpened(null);
            goBack(from);
            // Evidence may have been linked or unlinked inside; refresh the counts.
            controls.list().then((r) => setRows(r.controls)).catch(() => {});
          }}
          onSaved=${(updated: Control) =>
            setRows((current) => current.map((c) =>
              (c.id === updated.id ? { ...updated, evidence_count: c.evidence_count } : c)))}
        />`
      : null}
  </>`;
}
