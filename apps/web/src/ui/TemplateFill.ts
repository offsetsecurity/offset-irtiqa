import { useMemo, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import {
  templates, type TemplateDoc, type TemplateFill, type TemplateItem, type TemplatePart, type TemplateStatus,
} from "../persistence/apiClient.js";

/**
 * Filling the ISMS documents in without opening Word.
 *
 * Three kinds of question, in the order a person meets them. About your
 * company is asked once and used in every document. Your choices already have
 * the usual answer. Then each document has the few questions only it asks.
 * Whatever the registers already hold (risks, objectives, suppliers, the
 * scope) is not asked again: the document shows how many records it will take
 * and where to add more.
 *
 * Nothing here is saved until Save is pressed, and a blank left empty stays
 * yellow in the downloaded file, so nobody is forced to answer everything
 * today.
 */

/** The register a table is filled from, for the line that says where to add more. */
const SOURCES: Record<string, { label: string; route: string }> = {
  issues: { label: "Internal and external issues", route: "isms" },
  parties: { label: "Interested parties", route: "parties" },
  vendors: { label: "Suppliers", route: "vendors" },
  policies: { label: "Policies", route: "policies" },
  communications: { label: "Communications", route: "communications" },
  audits: { label: "Audits and reviews", route: "reviews" },
  findings: { label: "Findings", route: "findings" },
  improvements: { label: "Findings", route: "findings" },
  objectives: { label: "Objectives", route: "objectives" },
  objective_plans: { label: "Objectives", route: "objectives" },
  objective_progress: { label: "Objectives", route: "objectives" },
  risk_plan: { label: "Risks", route: "risks" },
  risk_actions: { label: "Tasks linked to a risk", route: "tasks" },
  risk_accepted: { label: "Risks", route: "risks" },
  soa: { label: "Statement of Applicability", route: "soa" },
  training: { label: "Training", route: "training" },
  assets: { label: "Assets", route: "assets" },
  incidents: { label: "Incidents", route: "incidents" },
  risks: { label: "Risks", route: "risks" },
};

type Values = Record<string, string>;
type Lists = Record<string, string[][]>;

const sectionsOf = (items: TemplateItem[]): { name: string; items: TemplateItem[] }[] => {
  const out: { name: string; items: TemplateItem[] }[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.name === it.section) last.items.push(it);
    else out.push({ name: it.section, items: [it] });
  }
  return out;
};

export function TemplateFillScreen({ data, start, canEdit, onClose, onSaved }: {
  data: TemplateFill;
  start: string;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (status: TemplateStatus[]) => void;
}): VNode {
  const { manifest } = data;
  const [step, setStep] = useState(start || "company");
  const [values, setValues] = useState<Values>(data.answers.values);
  const [lists, setLists] = useState<Lists>(data.answers.lists);
  const [status, setStatus] = useState<TemplateStatus[]>(data.status);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const docs = manifest.documents;
  const shared = useMemo(() => new Map(manifest.shared.map((s) => [s.name, s])), [manifest]);
  const docOf = (no: string): TemplateDoc | undefined => docs.find((d) => d.no === no);
  const left = (file: string): number => status.find((s) => s.file === file)?.left ?? 0;

  const set = (key: string, v: string): void => {
    setValues((cur) => ({ ...cur, [key]: v }));
    setDirty(true);
    setNote(null);
  };

  /** What shows in an empty box: the usual answer, or what the product already holds. */
  const placeholder = (key: string, doc?: TemplateDoc): string => {
    if (data.known[key]) return data.known[key]!;
    const s = shared.get(key);
    if (s) return s.default?.startsWith("@") ? values[s.default.slice(1)] ?? "" : s.default ?? s.hint ?? "";
    const f = doc?.fields[key];
    return f ? f.default || f.hint : "";
  };

  async function save(): Promise<boolean> {
    setBusy(true);
    setNote(null);
    try {
      const r = await templates.saveAnswers({ values, lists });
      setStatus(r.status);
      onSaved(r.status);
      setDirty(false);
      setNote({ kind: "ok", text: "Saved." });
      return true;
    } catch (err) {
      setNote({ kind: "err", text: (err as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const go = async (to: string): Promise<void> => {
    if (dirty && canEdit && !(await save())) return;
    setStep(to);
    window.scrollTo({ top: 0 });
  };

  const input = (key: string, opts: { long?: boolean; doc?: TemplateDoc } = {}): VNode => {
    const common = {
      value: values[key] ?? "",
      placeholder: placeholder(key, opts.doc),
      disabled: !canEdit,
      onInput: (e: Event) => set(key, (e.target as HTMLInputElement).value),
    };
    return opts.long
      ? html`<textarea rows="3" ...${common}></textarea>`
      : html`<input type="text" ...${common} />`;
  };

  const groupFields = (group: string): VNode[] =>
    manifest.shared.filter((s) => s.group === group).map((s) => html`
      <label class=${`fld${s.long ? " wide" : ""}`} key=${s.name}>
        <span>${s.label}</span>
        ${input(s.name, { long: s.long })}
        ${s.hint && s.default ? html`<em class="hint">${s.hint}</em>` : null}
      </label>`);

  // ── one document ───────────────────────────────────────────────────────────
  const cell = (parts: TemplatePart[], doc: TemplateDoc): VNode => html`<td>
    ${parts.map((p, i) => {
      if (p.name) {
        return html`<span key=${i}>${input(p.name, { doc })}</span>`;
      }
      if (p.computed) return html`<span key=${i} class="muted">${p.hint ?? ""}</span>`;
      return html`<span key=${i}>${p.text ?? p.hint ?? p.suggest ?? ""}</span>`;
    })}
  </td>`;

  const fieldLabel = (key: string, doc: TemplateDoc): string => {
    const f = doc.fields[key];
    if (f?.label) return f.label;
    return f?.context ? f.context : key;
  };

  const renderItem = (it: TemplateItem, doc: TemplateDoc, n: number): VNode => {
    if (it.t === "field" && it.name) {
      const f = doc.fields[it.name];
      const known = data.known[it.name];
      return html`<label class=${`fld${f?.long ? " wide" : ""}`} key=${n}>
        <span>${fieldLabel(it.name, doc)}</span>
        ${input(it.name, { long: f?.long, doc })}
        ${known && !values[it.name] ? html`<em class="hint">Taken from your ISMS screen. Type here to use different wording.</em>` : null}
        ${f?.label && f.context.replace(/\.\.\./g, "").trim().length > 8 ? html`<em class="hint">${f.context}</em>` : null}
        ${!known && f?.hint && f.hint !== f.default ? html`<em class="hint">${f.hint}</em>` : null}
      </label>`;
    }
    if (it.t === "grid") {
      return html`<div class="wide tpl-grid" key=${n}>
        <div class="isms-table"><table>
          <thead><tr>${(it.header ?? []).map((h, i) => html`<th key=${i}>${h}</th>`)}</tr></thead>
          <tbody>${(it.rows ?? []).map((r, ri) => html`<tr key=${ri}>${r.map((c) => cell(c, doc))}</tr>`)}</tbody>
        </table></div>
      </div>`;
    }
    if (it.t === "list" && it.id) return listEditor(it, n);
    if (it.t === "source" && it.source) {
      const src = SOURCES[it.source];
      const count = data.counts[it.source] ?? 0;
      return html`<div class="wide tpl-source" key=${n}>
        <b>${(it.header ?? []).slice(0, 3).join(", ")}${(it.header?.length ?? 0) > 3 ? "…" : ""}</b>
        ${count
          ? html` are filled from ${count} record${count === 1 ? "" : "s"} in ${src?.label ?? "Assure"}.`
          : html` will be filled from ${src?.label ?? "Assure"} once you add some. Until then the example rows stay.`}
        ${src ? html` <a href=${`#/${src.route}`}>Open ${src.label}</a>` : null}
      </div>`;
    }
    return html`<span key=${n}></span>`;
  };

  const listEditor = (it: TemplateItem, n: number): VNode => {
    const id = it.id!;
    const header = it.header ?? [];
    const rows = lists[id] ?? [];
    const library = manifest.library[id] ?? [];
    const setRows = (next: string[][]): void => {
      // The reference column counts up by itself.
      const prefix = /^\w-/.exec(rows.find((r) => r[0])?.[0] ?? "")?.[0] ?? (id.endsWith("laws") ? "L-" : id.endsWith("contracts") ? "C-" : id.endsWith("standards") ? "S-" : "");
      const numbered = prefix && header[0] === "Ref"
        ? next.map((r, i) => [`${prefix}${String(i + 1).padStart(2, "0")}`, ...r.slice(1)])
        : next;
      setLists((cur) => ({ ...cur, [id]: numbered }));
      setDirty(true);
      setNote(null);
    };
    const blank = (): string[] => header.map(() => "");
    const edit = (r: number, c: number, v: string): void =>
      setRows(rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
    const have = new Set(rows.map((r) => r[1]));
    return html`<div class="wide tpl-list" key=${n}>
      <p class="muted">${manifest.listHelp[id] ?? ""}</p>
      ${rows.length ? html`<div class="isms-table"><table>
        <thead><tr>${header.map((h, i) => html`<th key=${i}>${h}</th>`)}<th></th></tr></thead>
        <tbody>${rows.map((row, r) => html`<tr key=${r}>
          ${header.map((_, c) => html`<td key=${c}>
            ${header[c] === "Ref"
              ? html`<span class="muted">${row[c]}</span>`
              : html`<input type="text" disabled=${!canEdit} value=${row[c] ?? ""}
                  onInput=${(e: Event) => edit(r, c, (e.target as HTMLInputElement).value)} />`}
          </td>`)}
          <td>${canEdit ? html`<button type="button" class="btn small danger" title="Remove this row"
            onClick=${() => setRows(rows.filter((_, i) => i !== r))}>Remove</button>` : null}</td>
        </tr>`)}</tbody>
      </table></div>` : html`<p class="muted">Nothing added yet. The document keeps its example rows.</p>`}
      ${canEdit ? html`<div class="row-actions" style="margin-top:8px">
        <button type="button" class="btn small" onClick=${() => setRows([...rows, blank()])}>Add a row</button>
        ${library.length ? html`<select class="tpl-pick" value="" onChange=${(e: Event) => {
          const sel = e.target as HTMLSelectElement;
          const item = library[Number(sel.value)];
          if (item) setRows([...rows, [...item.row]]);
          sel.value = "";
        }}>
          <option value="">Add one of the common ones…</option>
          ${library.map((l, i) => html`<option key=${i} value=${i} disabled=${have.has(l.row[1])}>${l.label}</option>`)}
        </select>` : null}
      </div>` : null}
    </div>`;
  };

  // ── the page ───────────────────────────────────────────────────────────────
  const steps: { id: string; title: string; sub: string; todo?: number }[] = [
    { id: "company", title: manifest.groups.find((g) => g.id === "company")?.title ?? "About your company", sub: "Asked once" },
    { id: "choices", title: manifest.groups.find((g) => g.id === "choices")?.title ?? "Your choices", sub: "Usual answers filled in" },
    // The ISMS set is numbered 00 to 13; the starter policies (P1 to P7) are not.
    ...docs.map((d) => ({ id: d.no, title: /^\d/.test(d.no) ? `${d.no}  ${d.title}` : d.title, sub: "", todo: left(d.file) })),
  ];
  const doc = docOf(step);
  const idx = steps.findIndex((s) => s.id === step);
  const next = steps[idx + 1];

  const body = (): VNode => {
    if (step === "company" || step === "choices") {
      const g = manifest.groups.find((x) => x.id === step)!;
      return html`<section class="card pad">
        <div class="section-title"><h2>${g.title}</h2></div>
        <p class="muted section-note">${g.note}</p>
        <div class="form-grid">${groupFields(step)}</div>
      </section>`;
    }
    if (!doc) return html`<div class="card pad muted">Choose a document.</div>`;
    const sections = sectionsOf(doc.items);
    return html`<section class="card pad">
      <div class="section-title">
        <h2>${doc.title} <span class="muted clause">${doc.id}</span></h2>
        <div class="row-actions">
          <a class="btn small primary" href=${templates.filledUrl(doc.file)} download=${doc.file}>Download filled</a>
        </div>
      </div>
      <p class="muted section-note">
        ${left(doc.file) === 0
          ? "Every blank is filled."
          : `${left(doc.file)} blank${left(doc.file) === 1 ? "" : "s"} still yellow. Anything you leave empty stays yellow in the file, so you can finish it in Word.`}
        ${" "}Your company details come from <button type="button" class="linklike" onClick=${() => void go("company")}>${steps[0]!.title}</button>.
      </p>
      ${sections.length === 0 || (sections.length === 1 && sections[0]!.items.length === 0)
        ? html`<p class="muted">This document has nothing to ask. It is filled from your company details and your registers.</p>` : null}
      ${sections.map((s, si) => html`<div key=${si} class="tpl-section">
        <h3>${s.name}</h3>
        <div class="form-grid">${s.items.map((it, i) => renderItem(it, doc, i))}</div>
      </div>`)}
    </section>`;
  };

  return html`<div class="isms">
    <div class="tpl-top">
      <button type="button" class="btn" onClick=${() => { if (!dirty || confirm("Leave without saving?")) onClose(); }}>Back to templates</button>
      <span class="muted">Fill your documents in here, then download them ready to hand to an auditor.</span>
    </div>
    ${note ? html`<div class=${note.kind === "ok" ? "ok-note" : "err"}>${note.text}</div>` : null}
    <div class="tpl-layout">
      <nav class="tpl-nav card">
        ${steps.map((s) => html`<button type="button" key=${s.id} class=${s.id === step ? "sel" : ""}
            onClick=${() => void go(s.id)}>
          <span>${s.title}</span>
          ${s.todo === undefined ? html`<em>${s.sub}</em>`
            : s.todo === 0 ? html`<span class="pill green">Done</span>`
            : html`<span class="pill amber">${s.todo}</span>`}
        </button>`)}
      </nav>
      <div class="tpl-body">
        ${body()}
        ${canEdit ? html`<div class="row-actions form-actions tpl-save">
          <button type="button" class="btn primary" disabled=${busy || !dirty} onClick=${() => void save()}>
            ${busy ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
          ${next ? html`<button type="button" class="btn" disabled=${busy} onClick=${() => void go(next.id)}>Save and go to next</button>` : null}
          <a class="btn" href=${templates.allFilledUrl} download="ISMS_documents.zip">Download all filled (zip)</a>
        </div>` : null}
      </div>
    </div>
  </div>`;
}
