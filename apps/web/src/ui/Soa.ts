import { useEffect, useMemo, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import {
  programme, controls, risks as risksApi, type Programme, type Control, type Pack,
} from "../persistence/apiClient.js";
import { STATUS_LABEL, STATUS_PILL, themeColor, pct } from "./format.js";
import { ControlDetail } from "./ControlDetail.js";

/**
 * The Statement of Applicability.
 *
 * For ISO 27001 this is the document, not a screen: the certification auditor
 * asks for it first. It has to say, for every Annex A control, whether it
 * applies and why — and an exclusion with no stated reason is a finding, so
 * that gap is counted at the top rather than left to be discovered.
 *
 * Applicability is not a separate field. A control marked "not applicable" is
 * excluded, which keeps one source of truth instead of two that can disagree.
 */

type Filter = "all" | "included" | "excluded" | "unjustified" | "contradiction";

export function Soa({ themes, itemLabel, canEdit, pack }: {
  themes: Record<string, string>;
  itemLabel: string;
  canEdit: boolean;
  pack: Pack;
}): VNode {
  const [prog, setProg] = useState<Programme | null>(null);
  // Where the product has an ISMS screen, scope and method are written there;
  // otherwise this page is the only place to write them.
  const ismsElsewhere = pack.features?.["ismsScreen"] === true;
  const [rows, setRows] = useState<Control[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [detail, setDetail] = useState<Control | null>(null);
  /**
   * Controls a risk points at. Excluding one of those is the contradiction an
   * auditor spots in a minute: you say the control does not apply, and your own
   * risk register says it treats a risk you have.
   */
  const [treating, setTreating] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    Promise.all([programme.get(), controls.list(), risksApi.list()])
      .then(([p, c, r]) => {
        if (!live) return;
        setProg(p);
        setRows(c.controls);
        setTreating(new Set(r.risks.flatMap((risk) => risk.control_ids)));
      })
      .catch((err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  const excluded = (c: Control): boolean => c.status === "not_applicable";
  const unjustified = (c: Control): boolean => excluded(c) && !c.justification.trim();
  const contradicted = (c: Control): boolean => excluded(c) && treating.has(c.id);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((c) => {
      if (filter === "included" && excluded(c)) return false;
      if (filter === "excluded" && !excluded(c)) return false;
      if (filter === "unjustified" && !unjustified(c)) return false;
      if (filter === "contradiction" && !contradicted(c)) return false;
      return (
        !needle ||
        c.ref.toLowerCase().includes(needle) ||
        c.title.toLowerCase().includes(needle) ||
        c.justification.toLowerCase().includes(needle)
      );
    });
  }, [rows, q, filter, treating]);

  async function save(id: string, patch: Partial<Control>): Promise<void> {
    const before = rows.find((c) => c.id === id);
    if (!before) return;
    setRows((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setSaving((s) => ({ ...s, [id]: true }));
    try {
      const { control } = await controls.update(id, patch);
      setRows((cur) => cur.map((c) => (c.id === id ? { ...control, evidence_count: c.evidence_count } : c)));
      setError("");
    } catch (err) {
      setRows((cur) => cur.map((c) => (c.id === id ? before : c)));
      setError((err as Error).message);
    } finally {
      setSaving((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
    }
  }

  async function saveProgramme(patch: Partial<Programme>): Promise<void> {
    try {
      setProg(await programme.update(patch));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (error && !prog) return html`<div class="card pad err">${error}</div>`;
  if (!prog) return html`<div class="card pad muted">Loading…</div>`;

  const included = rows.filter((c) => !excluded(c)).length;
  const gaps = rows.filter(unjustified).length;
  const clashes = rows.filter(contradicted).length;
  const implemented = rows.filter((c) => c.status === "implemented").length;

  return html`<>
    <div class=${ismsElsewhere ? "" : "grid two"} style="margin-bottom:16px">
      ${ismsElsewhere ? null : html`<div class="card pad">
        <div class="section-title"><h2>ISMS scope</h2></div>
        <label class="fld">
          <span>What the management system covers</span>
          <textarea rows="3" disabled=${!canEdit} value=${prog.scope}
            placeholder="Sites, services, people and systems that are in scope — and anything deliberately outside it."
            onBlur=${(e: Event) => {
              const value = (e.target as HTMLTextAreaElement).value;
              if (value !== prog.scope) void saveProgramme({ scope: value });
            }}
          ></textarea>
        </label>
        <label class="fld" style="margin:0">
          <span>Risk assessment methodology</span>
          <textarea rows="3" disabled=${!canEdit} value=${prog.methodology}
            placeholder="How risk is identified, scored and accepted, and who decides."
            onBlur=${(e: Event) => {
              const value = (e.target as HTMLTextAreaElement).value;
              if (value !== prog.methodology) void saveProgramme({ methodology: value });
            }}
          ></textarea>
        </label>
      </div>`}

      <div class="card pad">
        <div class="section-title"><h2>Statement completeness</h2>
          ${ismsElsewhere
            ? html`<span class="muted" style="font-size:12px">ISMS scope and risk method are written on the${" "}<a href="#/isms">ISMS</a>${" "}screen, and print at the top of this statement.</span>`
            : null}</div>
        <div class="grid cards" style="grid-template-columns:1fr 1fr;gap:10px">
          <div class="card pad stat" style="border-left:3px solid #1e3a8a;box-shadow:none">
            <div class="lbl">Applicable</div>
            <div class="val">${included}</div>
            <div class="delta">of ${rows.length} ${itemLabel.toLowerCase()}s</div>
          </div>
          <div class="card pad stat" style="border-left:3px solid #0f766e;box-shadow:none">
            <div class="lbl">Implemented</div>
            <div class="val">${pct(implemented, included)}%</div>
            <div class="delta">${implemented} of ${included} applicable</div>
          </div>
        </div>
        <div class=${`soa-gap${gaps ? " bad" : ""}`}>
          ${gaps
            ? html`<>
                <b>${gaps} exclusion${gaps === 1 ? "" : "s"} with no reason given.</b>
                <span> An auditor will ask why each excluded control does not apply. </span>
                <button type="button" class="linkish" onClick=${() => setFilter("unjustified")}>
                  Show them
                </button>
              </>`
            : html`<b>Every exclusion has a stated reason.</b>`}
        </div>

        ${clashes
          ? html`<div class="soa-gap bad" style="margin-top:8px">
              <b>${clashes} excluded ${clashes === 1 ? "control is" : "controls are"} treating a
                risk you have recorded.</b>
              <span> Either the control applies after all, or the risk should not point at it.
                Whichever it is, fix it before an auditor finds it. </span>
              <button type="button" class="linkish" onClick=${() => setFilter("contradiction")}>
                Show them
              </button>
            </div>`
          : null}
      </div>
    </div>

    <div class="card pad">
      <div class="toolbar">
        <input type="search" placeholder="Search the statement…" value=${q}
               onInput=${(e: Event) => setQ((e.target as HTMLInputElement).value)} />
        <select value=${filter}
                onChange=${(e: Event) => setFilter((e.target as HTMLSelectElement).value as Filter)}>
          <option value="all">All ${itemLabel.toLowerCase()}s</option>
          <option value="included">Applicable only</option>
          <option value="excluded">Excluded only</option>
          <option value="unjustified">Excluded without a reason</option>
          <option value="contradiction">Excluded but treating a risk</option>
        </select>
        <div class="toolbar-note muted">${shown.length} of ${rows.length}</div>
      </div>

      ${error ? html`<div class="err" role="alert">${error}</div>` : null}

      <table>
        <thead>
          <tr>
            <th style="width:90px">Ref</th>
            <th>${itemLabel}</th>
            <th style="width:110px">Applies</th>
            <th style="width:140px">Status</th>
            <th style="width:96px">Evidence</th>
            <th>Justification</th>
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
              <td class="clickable" onClick=${() => setDetail(c)} title="Open the full record">
                <div>
                  ${c.title}
                  ${contradicted(c)
                    ? html`<span class="pill red" style="margin-left:6px">treats a risk</span>`
                    : null}
                </div>
                <div class="muted" style="font-size:11.5px">${themes[c.theme] ?? c.theme}</div>
              </td>
              <td>
                ${canEdit
                  ? html`<select class=${`status-select ${excluded(c) ? "slate" : "green"}`}
                            value=${excluded(c) ? "no" : "yes"}
                            onChange=${(e: Event) => {
                              const yes = (e.target as HTMLSelectElement).value === "yes";
                              void save(c.id, { status: yes ? "not_started" : "not_applicable" });
                            }}>
                      <option value="yes">Applies</option>
                      <option value="no">Excluded</option>
                    </select>`
                  : html`<span class=${`pill ${excluded(c) ? "slate" : "green"}`}>
                      ${excluded(c) ? "Excluded" : "Applies"}
                    </span>`}
              </td>
              <td>
                <span class=${`pill ${STATUS_PILL[c.status]}`}>${STATUS_LABEL[c.status]}</span>
              </td>
              <td class=${(c.evidence_count ?? 0) ? "" : "muted"}
                  title=${(c.evidence_count ?? 0) ? "Evidence items linked to this control" : "No evidence linked yet"}>
                ${(c.evidence_count ?? 0) ? html`<span class="pill green">Yes \u00b7 ${c.evidence_count}</span>` : "No"}
              </td>
              <td>
                ${canEdit
                  ? html`<input class=${`owner-input${unjustified(c) ? " missing" : ""}`}
                            value=${c.justification}
                            placeholder=${excluded(c) ? "Why does this not apply?" : "Why it applies: a risk, law, contract or need"}
                            onBlur=${(e: Event) => {
                              const value = (e.target as HTMLInputElement).value;
                              if (value !== c.justification) void save(c.id, { justification: value });
                            }}
                            onKeyDown=${(e: KeyboardEvent) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }} />`
                  : html`<span class=${unjustified(c) ? "err" : "muted"}>
                      ${c.justification || (excluded(c) ? "No reason given" : "—")}
                    </span>`}
              </td>
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
          onClose=${() => {
            setDetail(null);
            controls.list().then((r) => setRows(r.controls)).catch(() => {});
          }}
          onSaved=${(updated: Control) =>
            setRows((cur) => cur.map((c) =>
              (c.id === updated.id ? { ...updated, evidence_count: c.evidence_count } : c)))}
        />`
      : null}
  </>`;
}
