import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import {
  templates, policies, attachments, type PackTemplate, type TemplateFill, type TemplateStatus,
} from "../persistence/apiClient.js";
import { policyRegister } from "./registers.js";
import { TemplateFillScreen } from "./TemplateFill.js";

/**
 * The starter documents that ship with the pack.
 *
 * A blank page is what stops most first ISMS attempts, and a policy is harder
 * to start than a register row: nobody knows what the sections are supposed to
 * be. These are ordinary Word files, downloaded and edited offline, with no
 * link back here — once it is yours, it is yours.
 *
 * "Add to my policies" does the first step of document control for them: a
 * Draft entry in Documents, named after the template, with the Word file
 * attached. People looked for the master list of documents in Policies and
 * did not think to look here, so the template now goes to where they look.
 */
export function Templates({ canEdit, onAdded }: { canEdit: boolean; onAdded?: () => void }): VNode {
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<PackTemplate[] | null>(null);
  const [have, setHave] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  // Where the product can fill a template in with the organisation's own details.
  const [fill, setFill] = useState<TemplateFill | null>(null);
  const [filling, setFilling] = useState<string | null>(null);

  const norm = (s: unknown): string => String(s ?? "").trim().toLowerCase();

  useEffect(() => {
    let live = true;
    Promise.all([templates.index(), policies.list(), templates.fill()])
      .then(([d, existing, f]) => {
        if (!live) return;
        setNote(d.note);
        setRows(d.documents);
        setHave(new Set(existing.map((p) => norm(p["name"]))));
        setFill(f);
      })
      .catch((err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  async function adopt(t: PackTemplate): Promise<void> {
    setBusy(t.file);
    setError("");
    setDone("");
    try {
      // A template the product can fill in goes in with the organisation's own details.
      const res = await fetch(fillable(t.file) ? templates.filledUrl(t.file) : templates.url(t.file), { credentials: "same-origin" });
      if (!res.ok) throw new Error("The template could not be read.");
      const file = new File([await res.blob()], t.file);
      const policy = await policies.create({
        ...policyRegister.blank(),
        name: t.title,
        version: "0.1",
        changeNote: "Started from the template",
        notes: "Started from the template that ships with the product. Put your organisation's " +
          "details in it, have it approved, then attach the approved version and set the status.",
      });
      await attachments.add("policies", policy.id, file);
      setHave((h) => new Set(h).add(norm(t.title)));
      setDone(`"${t.title}" is now in Documents as a draft, with the Word file attached.`);
      onAdded?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  const doc = (file: string) => fill?.manifest.documents.find((d) => d.file === file);
  const fillable = (file: string): boolean => Boolean(doc(file));
  const stat = (file: string) => fill?.status.find((s) => s.file === file);

  if (error && !rows) return html`<div class="card pad err">${error}</div>`;
  if (!rows) return html`<div class="card pad muted">Loading…</div>`;

  if (filling !== null && fill) {
    return html`<${TemplateFillScreen} data=${fill} start=${filling} canEdit=${canEdit}
      onClose=${() => setFilling(null)}
      onSaved=${(status: TemplateStatus[]) => setFill((f) => (f ? { ...f, status } : f))} />`;
  }

  const total = fill?.status.reduce((n, s) => n + s.total, 0) ?? 0;
  const open = fill?.status.reduce((n, s) => n + s.left, 0) ?? 0;
  const pct = total ? Math.round(((total - open) / total) * 100) : 0;

  return html`<div class="card pad">
    <h2 class="section-h">Document templates</h2>
    ${fill
      ? html`<div class="tpl-banner">
          <div>
            <b>Fill your documents in here, not in Word.</b>${" "}Tell us about your organisation once. Your risks, objectives,
            suppliers and scope are put in from the rest of the product. Then download each document
            ready to use, with only the blanks you could not know left yellow.
            <div class="tpl-meter" title=${`${pct}% filled`}><i style=${`width:${pct}%`}></i></div>
            <span class="muted">${pct}% of the blanks in the documents are filled.</span>
          </div>
          <div class="row-actions">
            <button type="button" class="btn primary" onClick=${() => setFilling("company")}>Fill in</button>
            <a class="btn" href=${templates.allFilledUrl} download="ISMS_documents.zip">Download all filled (zip)</a>
          </div>
        </div>`
      : null}
    <p class="muted section-note">${note}</p>
    ${error ? html`<div class="err">${error}</div>` : null}
    ${done ? html`<div class="ok-note">${done}</div>` : null}
    <table>
      <tbody>
        ${rows.map((t) => html`
          <tr key=${t.file}>
            <td>
              <div>${t.title}</div>
              <div class="muted" style="font-size:11.5px">${t.about}</div>
            </td>
            <td style="width:430px;text-align:right;white-space:nowrap">
              ${fillable(t.file)
                ? html`${stat(t.file)?.left
                    ? html`<span class="pill amber" title="Blanks still yellow">${stat(t.file)!.left} left</span>`
                    : html`<span class="pill green">Filled</span>`}${" "}
                  <button type="button" class="btn small" onClick=${() => setFilling(doc(t.file)!.no)}>Fill in</button>${" "}
                  <a class="btn small" href=${templates.filledUrl(t.file)} download=${t.file}>Download filled</a>${" "}
                  <a class="muted tpl-blank" href=${templates.url(t.file)} download=${t.file} title="The empty template">blank</a>`
                : html`<a class="btn small" href=${templates.url(t.file)} download=${t.file}>Download</a>`}
              ${" "}
              ${have.has(norm(t.title))
                ? html`<span class="sl-in" style="margin-left:8px">In your policies</span>`
                : canEdit
                  ? html`<button type="button" class="btn small primary" disabled=${Boolean(busy)}
                      onClick=${() => void adopt(t)}>${busy === t.file ? "Adding…" : "Add to my policies"}</button>`
                  : null}
            </td>
          </tr>`)}
      </tbody>
    </table>
    <p class="muted" style="margin-top:14px">
      Each one is a Word document with the sections an auditor expects and yellow
      <b>&lt;placeholders&gt;</b> where your own details go. <b>Fill in</b> asks for those details here
      and puts them in for you. <b>Add to my policies</b> puts the document in Documents as a draft
      with the file attached; have it approved, then attach the approved version and set its owner and
      review date.
    </p>
  </div>`;
}
