import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { Modal, Field } from "./Modal.js";
import {
  programme, parties as partiesApi, objectives as objectivesApi,
  type Programme, type RegisterRow,
} from "../persistence/apiClient.js";
import { CONTEXT_LIBRARY, RISK_METHOD_TEMPLATE } from "./contextLibrary.js";

/**
 * The ISMS on one page: clauses 4.1 to 6.2, the part of ISO 27001 an auditor
 * reads at Stage 1 before looking at a single control.
 *
 * Nothing here is new data apart from the context issues and the certificate.
 * Scope and the risk method are the same two fields the Applicability screen
 * shows; parties and objectives are their own registers, summarised here with
 * a link. One screen to read the whole story, one place each thing is kept.
 */

interface Issue {
  id: string;
  issue: string;
  type: "Internal" | "External";
  impact: string;
}

interface Certification {
  body?: string;
  number?: string;
  issued?: string;
  expires?: string;
}

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const issuesOf = (p: Programme): Issue[] =>
  Array.isArray(p.attrs["context"]) ? (p.attrs["context"] as Issue[]) : [];

const certOf = (p: Programme): Certification =>
  (p.attrs["certification"] as Certification | undefined) ?? {};

function SectionHead({ title, clause, children }: { title: string; clause?: string; children?: unknown }): VNode {
  return html`<div class="section-title isms-head">
    <h2>${title} ${clause ? html`<span class="muted clause">clause ${clause}</span>` : null}</h2>
    <div class="row-actions">${children}</div>
  </div>`;
}

export function Isms({ canEdit }: { canEdit: boolean }): VNode {
  const [prog, setProg] = useState<Programme | null>(null);
  const [parties, setParties] = useState<RegisterRow[]>([]);
  const [objectives, setObjectives] = useState<RegisterRow[]>([]);
  const [scope, setScope] = useState("");
  const [method, setMethod] = useState("");
  const [cert, setCert] = useState<Certification>({});
  const [editing, setEditing] = useState<Issue | null>(null);
  const [library, setLibrary] = useState(false);
  const [industry, setIndustry] = useState(CONTEXT_LIBRARY[0]!.id);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<{ where: string; kind: "ok" | "err"; text: string } | null>(null);

  const adopt = (p: Programme): void => {
    setProg(p);
    setScope(p.scope ?? "");
    setMethod(p.methodology ?? "");
    setCert(certOf(p));
  };

  useEffect(() => {
    let live = true;
    Promise.all([programme.get(), partiesApi.list(), objectivesApi.list()])
      .then(([p, pa, ob]) => {
        if (!live) return;
        adopt(p);
        setParties(pa);
        setObjectives(ob);
      })
      .catch((err: Error) => live && setNote({ where: "top", kind: "err", text: err.message }));
    return () => { live = false; };
  }, []);

  async function save(where: string, patch: Parameters<typeof programme.update>[0], done = "Saved."): Promise<boolean> {
    setBusy(where);
    setNote(null);
    try {
      adopt(await programme.update(patch));
      setNote({ where, kind: "ok", text: done });
      return true;
    } catch (err) {
      setNote({ where, kind: "err", text: (err as Error).message });
      return false;
    } finally {
      setBusy("");
    }
  }

  if (!prog) {
    return html`<div class="card pad ${note ? "err" : "muted"}">${note?.text ?? "Loading…"}</div>`;
  }

  const issues = issuesOf(prog);
  const saveIssues = (next: Issue[], done: string): Promise<boolean> =>
    save("context", { attrs: { context: next } }, done);
  const noteFor = (where: string): VNode | null =>
    note?.where === where
      ? html`<div class=${note.kind === "ok" ? "ok-note" : "err"}>${note.text}</div>`
      : null;

  const insertStarters = async (): Promise<void> => {
    const set = CONTEXT_LIBRARY.find((c) => c.id === industry);
    if (!set) return;
    const have = new Set(issues.map((i) => i.issue.trim().toLowerCase()));
    const fresh = set.items
      .filter((i) => !have.has(i.issue.trim().toLowerCase()))
      .map((i) => ({ id: newId(), ...i }));
    const ok = await saveIssues(
      [...issues, ...fresh],
      fresh.length
        ? `${fresh.length} issue${fresh.length === 1 ? "" : "s"} added. Keep the ones that really shape your ISMS.`
        : "Nothing new: those issues are already in your list.",
    );
    if (ok) setLibrary(false);
  };

  const today = new Date().toISOString().slice(0, 10);
  const certDirty = JSON.stringify(cert) !== JSON.stringify(certOf(prog));

  return html`<div class="isms">
    ${noteFor("top")}

    <section class="card pad">
      <${SectionHead} title="Context of the organisation" clause="4.1">
        ${canEdit
          ? html`<button type="button" class="btn small" onClick=${() => setLibrary(true)}>Insert starter issues</button>
              <button type="button" class="btn small primary"
                onClick=${() => setEditing({ id: "", issue: "", type: "External", impact: "" })}>Add issue</button>`
          : null}
      <//>
      <p class="muted section-note">
        The internal and external issues that affect how you protect information: law, customers,
        threats, skills, old systems, budget. Your scope follows from these. An auditor asks
        "how did you decide your scope?" at Stage 1, and this is the answer.
      </p>
      ${noteFor("context")}
      ${issues.length
        ? html`<div class="isms-table"><table>
            <thead><tr>
              <th style="width:100px">Type</th>
              <th style="width:32%">Issue</th>
              <th>Why it matters to information security</th>
              ${canEdit ? html`<th style="width:70px"></th>` : null}
            </tr></thead>
            <tbody>${issues.map((x) => html`<tr key=${x.id}>
              <td><span class=${`pill ${x.type === "Internal" ? "blue" : "slate"}`}>${x.type}</span></td>
              <td><b>${x.issue}</b></td>
              <td class="muted">${x.impact || "—"}</td>
              ${canEdit
                ? html`<td><button type="button" class="btn small" onClick=${() => setEditing(x)}>Edit</button></td>`
                : null}
            </tr>`)}</tbody>
          </table></div>`
        : html`<div class="empty-note muted">
            No issues yet. Use <b>Insert starter issues</b> to begin from a list for your industry,
            then delete what does not apply.
          </div>`}
    </section>

    <section class="card pad">
      <${SectionHead} title="Interested parties" clause="4.2">
        <a class="btn small" href="#/parties">Open interested parties</a>
      <//>
      <p class="muted section-note">Who has a stake in your security, and what they need from you.</p>
      ${parties.length
        ? html`<div class="isms-table"><table>
            <thead><tr><th style="width:28%">Who</th><th style="width:130px">Kind</th><th>What they need</th></tr></thead>
            <tbody>${parties.map((p) => html`<tr key=${p.id}>
              <td><b>${String(p["name"] ?? "")}</b></td>
              <td>${String(p["kind"] ?? "") || "—"}</td>
              <td class="muted">${String(p["needs"] ?? "") || "—"}</td>
            </tr>`)}</tbody>
          </table></div>`
        : html`<div class="empty-note muted">
            None recorded. Interested parties has a sample library with the usual ones.
          </div>`}
    </section>

    <section class="card pad">
      <${SectionHead} title="ISMS scope" clause="4.3" />
      <p class="muted section-note">
        What the ISMS covers: which parts of the organisation, services, locations and systems.
        Say plainly what is left out. Your certificate will quote this.
      </p>
      ${noteFor("scope")}
      <textarea class="isms-text" rows="6" disabled=${!canEdit} value=${scope}
        placeholder="The ISMS covers ..."
        onInput=${(e: Event) => setScope((e.target as HTMLTextAreaElement).value)}></textarea>
      ${canEdit
        ? html`<div class="row-actions form-actions">
            <button type="button" class="btn primary" disabled=${busy === "scope" || scope === (prog.scope ?? "")}
              onClick=${() => void save("scope", { scope })}>${busy === "scope" ? "Saving…" : "Save scope"}</button>
          </div>`
        : null}
    </section>

    <section class="card pad">
      <${SectionHead} title="Risk assessment method" clause="6.1.2">
        ${canEdit && !method.trim()
          ? html`<button type="button" class="btn small" onClick=${() => setMethod(RISK_METHOD_TEMPLATE)}>
              Insert a suggested 5×5 method
            </button>`
          : null}
      <//>
      <p class="muted section-note">
        How risks are scored, which score is acceptable, who may accept a risk, and how often the
        register is reviewed. It has to give the same result when someone else repeats it.
      </p>
      ${noteFor("method")}
      <textarea class="isms-text" rows="10" disabled=${!canEdit} value=${method}
        onInput=${(e: Event) => setMethod((e.target as HTMLTextAreaElement).value)}></textarea>
      ${canEdit
        ? html`<div class="row-actions form-actions">
            <button type="button" class="btn primary"
              disabled=${busy === "method" || method === (prog.methodology ?? "")}
              onClick=${() => void save("method", { methodology: method })}>
              ${busy === "method" ? "Saving…" : "Save method"}
            </button>
          </div>`
        : null}
    </section>

    <section class="card pad">
      <${SectionHead} title="Information security objectives" clause="6.2">
        <a class="btn small" href="#/objectives">Open objectives</a>
      <//>
      <p class="muted section-note">Measurable goals, with an owner and a date.</p>
      ${objectives.length
        ? html`<div class="isms-table"><table>
            <thead><tr><th>Objective</th><th style="width:26%">Measure</th><th style="width:110px">Target</th>
              <th style="width:120px">By when</th><th style="width:100px">Status</th></tr></thead>
            <tbody>${objectives.map((o) => {
              const due = String(o["due_date"] ?? "");
              const status = String(o["status"] ?? "");
              const late = due && due < today && status !== "Met" && status !== "Missed";
              return html`<tr key=${o.id}>
                <td><b>${String(o["title"] ?? "")}</b></td>
                <td class="muted">${String(o["measure"] ?? "") || "—"}</td>
                <td>${String(o["target"] ?? "") || "—"}</td>
                <td class=${late ? "due overdue" : ""}>${due || "—"}</td>
                <td>${status || "—"}</td>
              </tr>`;
            })}</tbody>
          </table></div>`
        : html`<div class="empty-note muted">None yet. Objectives has a sample library to start from.</div>`}
    </section>

    <section class="card pad">
      <${SectionHead} title="Certification" />
      <p class="muted section-note">
        Your ISO/IEC 27001 certificate, once you have one. The expiry date appears on the Calendar,
        so recertification is not missed.
      </p>
      ${noteFor("cert")}
      <div class="form-grid">
        <${Field} label="Certification body">
          <input type="text" disabled=${!canEdit} value=${cert.body ?? ""} placeholder="BSI, Bureau Veritas, TÜV…"
            onInput=${(e: Event) => setCert((c) => ({ ...c, body: (e.target as HTMLInputElement).value }))} />
        <//>
        <${Field} label="Certificate number">
          <input type="text" disabled=${!canEdit} value=${cert.number ?? ""}
            onInput=${(e: Event) => setCert((c) => ({ ...c, number: (e.target as HTMLInputElement).value }))} />
        <//>
        <${Field} label="Issued">
          <input type="date" disabled=${!canEdit} value=${cert.issued ?? ""}
            onInput=${(e: Event) => setCert((c) => ({ ...c, issued: (e.target as HTMLInputElement).value }))} />
        <//>
        <${Field} label="Expires">
          <input type="date" disabled=${!canEdit} value=${cert.expires ?? ""}
            onInput=${(e: Event) => setCert((c) => ({ ...c, expires: (e.target as HTMLInputElement).value }))} />
        <//>
      </div>
      ${canEdit
        ? html`<div class="row-actions form-actions">
            <button type="button" class="btn primary" disabled=${busy === "cert" || !certDirty}
              onClick=${() => void save("cert", { attrs: { certification: cert } })}>
              ${busy === "cert" ? "Saving…" : "Save certificate"}
            </button>
          </div>`
        : null}
    </section>

    ${editing
      ? html`<${IssueDialog} issue=${editing} busy=${busy === "context"}
          onClose=${() => setEditing(null)}
          onSave=${async (x: Issue) => {
            const next = x.id
              ? issues.map((i) => (i.id === x.id ? x : i))
              : [...issues, { ...x, id: newId() }];
            if (await saveIssues(next, x.id ? "Issue updated." : "Issue added.")) setEditing(null);
          }}
          onDelete=${editing.id
            ? async () => {
                if (await saveIssues(issues.filter((i) => i.id !== editing.id), "Issue removed.")) setEditing(null);
              }
            : undefined} />`
      : null}

    ${library
      ? html`<${Modal} title="Insert starter issues" submitLabel="Insert" busy=${busy === "context"}
          onClose=${() => setLibrary(false)}
          onSubmit=${(e: Event) => { e.preventDefault(); void insertStarters(); }}>
          <div class="form-grid">
            <${Field} label="Industry" wide=${true}
              hint="Issues already in your list are skipped. Ten to fifteen that really apply read better to an auditor than a long list.">
              <select value=${industry} onChange=${(e: Event) => setIndustry((e.target as HTMLSelectElement).value)}>
                ${CONTEXT_LIBRARY.map((c) => html`<option value=${c.id}>${c.name} (${c.items.length})</option>`)}
              </select>
            <//>
          </div>
        <//>`
      : null}
  </div>`;
}

function IssueDialog({ issue, busy, onClose, onSave, onDelete }: {
  issue: Issue;
  busy: boolean;
  onClose: () => void;
  onSave: (x: Issue) => void;
  onDelete?: () => void;
}): VNode {
  const [draft, setDraft] = useState<Issue>(issue);
  const [error, setError] = useState("");
  return html`<${Modal} title=${issue.id ? "Edit issue" : "New issue"} submitLabel="Save" busy=${busy}
    error=${error} onClose=${onClose} onDelete=${onDelete}
    onSubmit=${(e: Event) => {
      e.preventDefault();
      if (!draft.issue.trim()) { setError("Say what the issue is."); return; }
      onSave({ ...draft, issue: draft.issue.trim(), impact: draft.impact.trim() });
    }}>
    <div class="form-grid">
      <${Field} label="Issue" wide=${true}>
        <input type="text" value=${draft.issue}
          onInput=${(e: Event) => setDraft((d) => ({ ...d, issue: (e.target as HTMLInputElement).value }))} />
      <//>
      <${Field} label="Type">
        <select value=${draft.type}
          onChange=${(e: Event) => setDraft((d) => ({ ...d, type: (e.target as HTMLSelectElement).value as Issue["type"] }))}>
          <option>External</option>
          <option>Internal</option>
        </select>
      <//>
      <${Field} label="Why it matters to information security" wide=${true}>
        <textarea rows="4" value=${draft.impact}
          onInput=${(e: Event) => setDraft((d) => ({ ...d, impact: (e.target as HTMLTextAreaElement).value }))}></textarea>
      <//>
    </div>
  <//>`;
}
