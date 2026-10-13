import { useEffect, useMemo, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import {
  controls as controlsApi, evidence as evidenceApi, tasks as tasksApi,
  type Control, type Pack,
} from "../persistence/apiClient.js";
import { STATUS_LABEL, themeColor, pct } from "./format.js";
import { ControlDetail } from "./ControlDetail.js";

/**
 * What is not done, and what to do about it.
 *
 * The Controls screen answers "where does this control stand"; this one answers
 * "what is left", which is a different question and the one asked before an
 * audit. It is derived entirely from controls and evidence - no state of its
 * own - so it cannot drift from the register it describes.
 *
 * Two gaps are worth telling apart, and most tools do not: a control nobody has
 * started, and a control called implemented with nothing to show for it. The
 * second is worse, because it will be found by somebody else.
 */

type Kind = "all" | "not_started" | "in_progress" | "unproven" | "unowned";

const KIND_LABEL: Record<Kind, string> = {
  all: "Everything outstanding",
  not_started: "Not started",
  in_progress: "In progress",
  unproven: "Implemented, no evidence",
  unowned: "Nobody owns it",
};

export function Gaps({ themes, itemLabel, canEdit, pack }: {
  themes: Record<string, string>;
  itemLabel: string;
  canEdit: boolean;
  pack: Pack;
}): VNode {
  const [rows, setRows] = useState<Control[]>([]);
  const [proved, setProved] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<Kind>("all");
  const [theme, setTheme] = useState("");
  const [detail, setDetail] = useState<Control | null>(null);
  const [raising, setRaising] = useState("");
  const [raised, setRaised] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load(): Promise<void> {
    const [c, e] = await Promise.all([controlsApi.list(), evidenceApi.list()]);
    setRows(c.controls);
    setProved(new Set(e.evidence.flatMap((item) => item.control_ids)));
    setLoading(false);
  }

  useEffect(() => {
    load().catch((err: Error) => {
      setError(err.message);
      setLoading(false);
    });
  }, []);

  const applies = (c: Control): boolean => c.status !== "not_applicable";
  const unproven = (c: Control): boolean => c.status === "implemented" && !proved.has(c.id);
  const outstanding = (c: Control): boolean =>
    applies(c) && (c.status !== "implemented" || unproven(c));

  const counts = useMemo(() => {
    const applicable = rows.filter(applies);
    return {
      applicable: applicable.length,
      implemented: applicable.filter((c) => c.status === "implemented").length,
      notStarted: applicable.filter((c) => c.status === "not_started").length,
      inProgress: applicable.filter((c) => c.status === "in_progress").length,
      unproven: applicable.filter(unproven).length,
      unowned: applicable.filter((c) => !c.owner.trim()).length,
    };
  }, [rows, proved]);

  const byTheme = useMemo(() => {
    const map = new Map<string, { total: number; done: number; open: number }>();
    for (const c of rows.filter(applies)) {
      const entry = map.get(c.theme) ?? { total: 0, done: 0, open: 0 };
      entry.total++;
      if (c.status === "implemented" && !unproven(c)) entry.done++;
      else entry.open++;
      map.set(c.theme, entry);
    }
    return [...map.entries()];
  }, [rows, proved]);

  const shown = useMemo(
    () =>
      rows.filter((c) => {
        if (theme && c.theme !== theme) return false;
        if (kind === "all") return outstanding(c);
        if (kind === "unproven") return unproven(c);
        if (kind === "unowned") return applies(c) && !c.owner.trim();
        return applies(c) && c.status === kind;
      }),
    [rows, proved, kind, theme],
  );

  async function raiseTask(c: Control): Promise<void> {
    setRaising(c.id);
    setError("");
    try {
      await tasksApi.create({
        title: `${c.ref} ${c.title}`,
        owner: c.owner,
        dueDate: c.due_date,
        priority: "Medium",
        notes: `Raised from the gap list. ${STATUS_LABEL[c.status] ?? c.status} when this task was raised.`,
        controlId: c.id,
      });
      setRaised((cur) => new Set(cur).add(c.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRaising("");
    }
  }

  if (loading) return html`<div class="card pad muted">Loading…</div>`;

  return html`<>
    <div class="grid cards" style="grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      <div class="card pad stat" style="border-left:3px solid #0f766e">
        <div class="lbl">Done and proved</div>
        <div class="val">${pct(counts.implemented - counts.unproven, counts.applicable)}%</div>
        <div class="delta">${counts.implemented - counts.unproven} of ${counts.applicable} that apply</div>
      </div>
      <div class="card pad stat" style="border-left:3px solid #dc2626">
        <div class="lbl">Not started</div>
        <div class="val">${counts.notStarted}</div>
        <div class="delta">nothing recorded yet</div>
      </div>
      <div class="card pad stat" style="border-left:3px solid #d97706">
        <div class="lbl">In progress</div>
        <div class="val">${counts.inProgress}</div>
        <div class="delta">started, not finished</div>
      </div>
      <div class="card pad stat" style="border-left:3px solid #7c3aed">
        <div class="lbl">Claimed, unproved</div>
        <div class="val">${counts.unproven}</div>
        <div class="delta">implemented with no evidence</div>
      </div>
    </div>

    <div class="card pad">
      <h2 class="section-h">By ${Object.keys(themes).length ? "theme" : "group"}</h2>
      <table>
        <tbody>
          ${byTheme.map(([id, t]) => html`
            <tr key=${id}>
              <td style="width:230px">
                <span class="ref" style=${`border-color:${themeColor(id)};color:${themeColor(id)}`}>
                  ${themes[id] ?? id}
                </span>
              </td>
              <td style="width:110px">${t.done} of ${t.total}</td>
              <td>
                <div style="background:var(--slate-soft);border-radius:6px;height:10px;overflow:hidden">
                  <div style=${`width:${pct(t.done, t.total)}%;height:100%;background:${themeColor(id)}`}></div>
                </div>
              </td>
              <td style="width:120px;text-align:right">
                ${t.open
                  ? html`<button type="button" class="linkish"
                           onClick=${() => { setTheme(id); setKind("all"); }}>
                      ${t.open} outstanding
                    </button>`
                  : html`<span class="muted">all done</span>`}
              </td>
            </tr>`)}
        </tbody>
      </table>
    </div>

    <div class="card pad">
      <div class="toolbar">
        <select value=${kind} onChange=${(e: Event) => setKind((e.target as HTMLSelectElement).value as Kind)}>
          ${(Object.keys(KIND_LABEL) as Kind[]).map((k) => html`<option value=${k}>${KIND_LABEL[k]}</option>`)}
        </select>
        <select value=${theme} onChange=${(e: Event) => setTheme((e.target as HTMLSelectElement).value)}>
          <option value="">All themes</option>
          ${Object.entries(themes).map(([id, name]) => html`<option value=${id}>${name}</option>`)}
        </select>
        <div class="toolbar-note muted">${shown.length} ${plural(shown.length, itemLabel)}</div>
      </div>

      ${error ? html`<div class="err" role="alert">${error}</div>` : null}

      ${shown.length === 0
        ? html`<p class="muted">Nothing here. That is the aim.</p>`
        : html`<table>
            <thead>
              <tr>
                <th style="width:90px">Ref</th>
                <th>${itemLabel}</th>
                <th style="width:130px">Status</th>
                <th style="width:150px">Owner</th>
                <th style="width:110px">Due</th>
                <th style="width:150px"></th>
              </tr>
            </thead>
            <tbody>
              ${shown.map((c) => html`
                <tr key=${c.id}>
                  <td>
                    <span class="ref" style=${`border-color:${themeColor(c.theme)};color:${themeColor(c.theme)}`}>
                      ${c.ref}
                    </span>
                  </td>
                  <td class="clickable" onClick=${() => setDetail(c)} title="Open the full record">
                    <div>${c.title}</div>
                    ${unproven(c)
                      ? html`<div class="muted" style="font-size:11.5px;color:var(--red)">
                          Implemented, but nothing is attached to prove it
                        </div>`
                      : null}
                  </td>
                  <td>${STATUS_LABEL[c.status] ?? c.status}</td>
                  <td>${c.owner || html`<span class="muted">nobody</span>`}</td>
                  <td>${c.due_date || html`<span class="muted">—</span>`}</td>
                  <td style="text-align:right">
                    ${canEdit
                      ? raised.has(c.id)
                        ? html`<span class="pill green">Task raised</span>`
                        : html`<button type="button" class="btn small" disabled=${raising === c.id}
                                 onClick=${() => void raiseTask(c)}>
                            ${raising === c.id ? "Raising…" : "Raise a task"}
                          </button>`
                      : null}
                  </td>
                </tr>`)}
            </tbody>
          </table>`}
    </div>

    ${detail
      ? html`<${ControlDetail} control=${detail} pack=${pack} canEdit=${canEdit}
               onClose=${() => setDetail(null)}
               onSaved=${(updated: Control) => {
                 setRows((cur) => cur.map((c) => (c.id === updated.id ? updated : c)));
                 setDetail(null);
               }} />`
      : null}
  </>`;
}

const plural = (n: number, word: string): string =>
  `${word.toLowerCase()}${n === 1 ? "" : "s"}`;
