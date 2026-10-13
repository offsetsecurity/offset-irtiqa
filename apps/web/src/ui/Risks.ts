import { useEffect, useMemo, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { heatmap } from "./charts.js";
import { Modal, Field } from "./Modal.js";
import {
  risks, riskToInput, RISK_STATUSES, RISK_TREATMENTS, pack,
  type Risk, type RiskInput, type RiskBand,
} from "../persistence/apiClient.js";
import { RISK_BAND_COLOR, since, plural } from "./format.js";
import { LinkPicker } from "./LinkPicker.js";
import { useTarget, settle, goBack, focusFix, type Target } from "./deepLink.js";
import { suggestControls } from "./suggest.js";
import type { LinkOption } from "./Register.js";

const BANDS: RiskBand[] = ["critical", "elevated", "acceptable"];
const SCORES = [1, 2, 3, 4, 5];

const blank = (): RiskInput => ({
  title: "", description: "", category: "", likelihood: 3, impact: 3,
  resLikelihood: null, resImpact: null, treatment: "Mitigate", status: "Open",
  owner: "", reviewDate: null, acceptedBy: null,
});

/**
 * The risk register.
 *
 * Scores are never computed here — inherent, residual and band all come from
 * the API, so this table and the dashboard can never tell different stories.
 */
export function Risks({ canEdit, controls = [], itemLabel = "control" }: {
  canEdit: boolean;
  /** What a risk can be treated by. */
  controls?: LinkOption[];
  itemLabel?: string;
}): VNode {
  const [rows, setRows] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [band, setBand] = useState("");

  const [editing, setEditing] = useState<Risk | null>(null);
  // Opened from a link such as the Golden thread's fix buttons.
  const target = useTarget("risks");
  const [opened, setOpened] = useState<Target | null>(null);
  const [draft, setDraft] = useState<RiskInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  /** The sample library, used only to suggest controls for a risk somebody types in. */
  const [samples, setSamples] = useState<Awaited<ReturnType<typeof pack.samples>> | null>(null);
  useEffect(() => {
    let live = true;
    pack.samples().then((s) => live && setSamples(s)).catch(() => { /* a pack without samples just gets no suggestions */ });
    return () => { live = false; };
  }, []);

  async function reload(): Promise<void> {
    const { risks: list } = await risks.list();
    setRows(list);
  }

  useEffect(() => {
    let live = true;
    risks
      .list()
      .then((r) => live && setRows(r.risks))
      .catch((err: Error) => live && setError(err.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!status || r.status === status) &&
        (!band || r.band === band) &&
        (!needle ||
          r.title.toLowerCase().includes(needle) ||
          r.category.toLowerCase().includes(needle) ||
          r.owner.toLowerCase().includes(needle)),
    );
  }, [rows, q, status, band]);

  /** Built from the rows on screen, so it always agrees with the table. */
  const cells = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of shown) {
      const key = `${r.impact}x${r.likelihood}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [shown]);

  function open(risk: Risk | null): void {
    setEditing(risk);
    setDraft(risk ? riskToInput(risk) : blank());
    setFormError("");
  }

  const close = (): void => {
    setEditing(null);
    setDraft(null);
    const from = opened;
    setOpened(null);
    goBack(from);
  };

  useEffect(() => {
    if (!target || target.id === "thread" || !rows.length) return;
    const row = rows.find((r) => r.id === target.id || String(r.seq) === target.id);
    settle("risks");
    if (!row) { setError("That risk is no longer in the register."); return; }
    setOpened(target);
    open(row);
    if (target.fix) focusFix(target.fix);
  }, [target, rows]);
  const set = (patch: Partial<RiskInput>): void =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    if (!draft) return;

    // The server enforces this too; catching it here saves a round trip and
    // explains itself next to the field that is wrong.
    if (draft.status === "Accepted" && !draft.acceptedBy?.trim()) {
      setFormError("An accepted risk needs a named person who accepted it.");
      return;
    }

    setBusy(true);
    setFormError("");
    try {
      if (editing) await risks.update(editing.id, draft);
      else await risks.create(draft);
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
      await risks.remove(editing.id);
      await reload();
      close();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return html`<div class="card pad muted">Loading…</div>`;
  if (error) return html`<div class="card pad err">${error}</div>`;

  const scoreChip = (value: number, chipBand: RiskBand): VNode =>
    html`<span class="score" style=${`background:${RISK_BAND_COLOR[chipBand]}`}>${value}</span>`;

  const bandOf = (score: number): RiskBand =>
    score >= 20 ? "critical" : score >= 12 ? "elevated" : "acceptable";

  // Risks that share a title: usually one added twice, which splits its links in two.
  const twins = Object.values(rows.reduce<Record<string, Risk[]>>((acc, r) => {
    const key = r.title.trim().toLowerCase();
    (acc[key] ??= []).push(r);
    return acc;
  }, {})).filter((g) => g.length > 1);

  return html`<>
    ${twins.length
      ? html`<div class="card pad dup-note" role="status" style="margin-bottom:16px">
          <b>${twins.length === 1 ? "One risk is" : `${twins.length} risks are`} in the register twice.</b>
          ${twins.map((g) => html` <span>${g.map((r) => `#${r.seq}`).join(" and ")} are both "${g[0]!.title}".</span>`)}
          <span> Open the newer one and delete it, or rename it if it is a different risk.</span>
        </div>`
      : null}
    <div class="grid two" style="margin-bottom:16px">
      <div class="card pad">
        <div class="section-title"><h2>Inherent risk profile</h2>
          <span class="muted" style="font-size:12px">${shown.length} plotted</span>
        </div>
        ${heatmap(cells, (impact, likelihood) => {
          setQ("");
          setBand("");
          setStatus("");
          // Nudge the table towards the cell the user clicked.
          const match = rows.find((r) => r.impact === impact && r.likelihood === likelihood);
          if (match) open(match);
        })}
      </div>

      <div class="card pad">
        <div class="section-title"><h2>By band</h2></div>
        <div class="legend">
          ${BANDS.map((b) => html`
            <div>
              <span class="dot" style=${`background:${RISK_BAND_COLOR[b]}`}></span>
              <span style="text-transform:capitalize">${b}</span>
              <b>${shown.filter((r) => r.band === b).length}</b>
            </div>`)}
        </div>
        <div class="section-title" style="margin:20px 0 12px"><h2>By status</h2></div>
        <div class="legend">
          ${RISK_STATUSES.map((s) => html`
            <div>
              <span class="dot" style="background:#cbd5e1"></span>
              <span>${s}</span>
              <b>${shown.filter((r) => r.status === s).length}</b>
            </div>`)}
        </div>
      </div>
    </div>

    <div class="card pad">
      <div class="toolbar">
        <input type="search" placeholder="Search risks…" value=${q}
               onInput=${(e: Event) => setQ((e.target as HTMLInputElement).value)} />
        <select value=${status} onChange=${(e: Event) => setStatus((e.target as HTMLSelectElement).value)}>
          <option value="">All statuses</option>
          ${RISK_STATUSES.map((s) => html`<option value=${s}>${s}</option>`)}
        </select>
        <select value=${band} onChange=${(e: Event) => setBand((e.target as HTMLSelectElement).value)}>
          <option value="">All bands</option>
          ${BANDS.map((b) => html`<option value=${b} style="text-transform:capitalize">${b}</option>`)}
        </select>
        <div class="toolbar-note muted">${shown.length} of ${rows.length}</div>
        ${canEdit
          ? html`<button class="btn primary" onClick=${() => open(null)}>Add risk</button>`
          : null}
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:52px">#</th>
            <th>Risk</th>
            <th style="width:150px">Owner</th>
            <th style="width:110px">Treatment</th>
            <th style="width:70px;text-align:right">Inherent</th>
            <th style="width:70px;text-align:right">Residual</th>
            <th style="width:100px">Updated</th>
          </tr>
        </thead>
        <tbody>
          ${shown.map((r) => html`
            <tr key=${r.id} class=${canEdit ? "clickable" : ""}
                onClick=${canEdit ? () => open(r) : undefined}>
              <td class="muted">${r.seq}</td>
              <td>
                <div>${r.title}</div>
                <div class="muted" style="font-size:11.5px">
                  ${r.category || "Uncategorised"} · ${r.status}
                  ${r.control_ids.length ? ` · ${r.control_ids.length} linked` : ""}
                </div>
              </td>
              <td class="muted">${r.owner || "—"}</td>
              <td class="muted">${r.treatment}</td>
              <td style="text-align:right">${scoreChip(r.inherent, r.band)}</td>
              <td style="text-align:right">${scoreChip(r.residual, bandOf(r.residual))}</td>
              <td class="muted">${since(r.updated_at)}</td>
            </tr>`)}
        </tbody>
      </table>

      ${shown.length === 0
        ? html`<p class="muted" style="padding:16px 4px">No risks match those filters.</p>`
        : null}
    </div>

    ${draft
      ? html`<${Modal}
          title=${editing ? `Risk ${editing.seq}` : "Add risk"}
          submitLabel=${editing ? "Save changes" : "Add risk"}
          busy=${busy}
          error=${formError}
          onClose=${close}
          onSubmit=${submit}
          onDelete=${editing ? remove : undefined}
        >
          <div class="form-grid">
            <${Field} label="Title" wide=${true}>
              <input required maxLength=${300} value=${draft.title}
                     onInput=${(e: Event) => set({ title: (e.target as HTMLInputElement).value })} />
            <//>
            <${Field} label="Category">
              <input value=${draft.category ?? ""} placeholder="e.g. Third party"
                     onInput=${(e: Event) => set({ category: (e.target as HTMLInputElement).value })} />
            <//>
            <${Field} label="Owner">
              <input data-fix="owner" value=${draft.owner ?? ""}
                     onInput=${(e: Event) => set({ owner: (e.target as HTMLInputElement).value })} />
            <//>

            <${Field} label="Likelihood" hint="1 rare, 5 almost certain">
              <select value=${String(draft.likelihood)}
                      onChange=${(e: Event) => set({ likelihood: Number((e.target as HTMLSelectElement).value) })}>
                ${SCORES.map((n) => html`<option value=${n}>${n}</option>`)}
              </select>
            <//>
            <${Field} label="Impact" hint="1 negligible, 5 severe">
              <select value=${String(draft.impact)}
                      onChange=${(e: Event) => set({ impact: Number((e.target as HTMLSelectElement).value) })}>
                ${SCORES.map((n) => html`<option value=${n}>${n}</option>`)}
              </select>
            <//>

            <${Field} label="Residual likelihood" hint="after treatment; blank if unchanged">
              <select value=${draft.resLikelihood == null ? "" : String(draft.resLikelihood)}
                      onChange=${(e: Event) => {
                        const v = (e.target as HTMLSelectElement).value;
                        set({ resLikelihood: v === "" ? null : Number(v) });
                      }}>
                <option value="">—</option>
                ${SCORES.map((n) => html`<option value=${n}>${n}</option>`)}
              </select>
            <//>
            <${Field} label="Residual impact" hint="after treatment; blank if unchanged">
              <select value=${draft.resImpact == null ? "" : String(draft.resImpact)}
                      onChange=${(e: Event) => {
                        const v = (e.target as HTMLSelectElement).value;
                        set({ resImpact: v === "" ? null : Number(v) });
                      }}>
                <option value="">—</option>
                ${SCORES.map((n) => html`<option value=${n}>${n}</option>`)}
              </select>
            <//>

            <${Field} label="Treatment">
              <select value=${draft.treatment}
                      onChange=${(e: Event) => set({ treatment: (e.target as HTMLSelectElement).value })}>
                ${RISK_TREATMENTS.map((t) => html`<option value=${t}>${t}</option>`)}
              </select>
            <//>
            <${Field} label="Status">
              <select value=${draft.status}
                      onChange=${(e: Event) => set({ status: (e.target as HTMLSelectElement).value })}>
                ${RISK_STATUSES.map((s) => html`<option value=${s}>${s}</option>`)}
              </select>
            <//>

            ${draft.status === "Accepted"
              ? html`<${Field} label="Accepted by" wide=${true}
                       hint="Required. Accepting a risk is a decision someone owns.">
                  <input required value=${draft.acceptedBy ?? ""}
                         onInput=${(e: Event) => set({ acceptedBy: (e.target as HTMLInputElement).value })} />
                <//>`
              : null}

            <${Field} label=${`${plural(itemLabel)[0]!.toUpperCase()}${plural(itemLabel).slice(1)} that treat this risk`} wide=${true}
                     hint="What reduces this risk. A risk you are reducing with nothing linked here shows as broken on the Golden thread.">
              <div data-fix="controls"><${LinkPicker} options=${controls} value=${draft.controlIds ?? []}
                             suggested=${suggestControls(draft.title, draft.category ?? "", samples, controls)}
                             onChange=${(ids: string[]) => set({ controlIds: ids })}
                             placeholder=${`Search ${plural(itemLabel)} to link…`} /></div>
            <//>
            <${Field} label="Description" wide=${true}>
              <textarea rows="3" value=${draft.description ?? ""}
                        onInput=${(e: Event) => set({ description: (e.target as HTMLTextAreaElement).value })}></textarea>
            <//>

            <div class="preview wide">
              <span>Inherent <b>${(draft.likelihood ?? 0) * (draft.impact ?? 0)}</b></span>
              <span> · Residual <b>${(draft.resLikelihood ?? draft.likelihood ?? 0) * (draft.resImpact ?? draft.impact ?? 0)}</b></span>
              <span class="muted"> — the server recalculates both on save</span>
            </div>
          </div>
        <//>`
      : null}
  </>`;
}
