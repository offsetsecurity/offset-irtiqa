import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { Modal, Field } from "./Modal.js";
import { ControlEvidence } from "./ControlEvidence.js";
import { ControlTests } from "./ControlTests.js";
import { ControlFix, type FixTarget } from "./ControlFix.js";
import { focusFix } from "./deepLink.js";
import {
  controls, pack as packApi,
  type Control, type ControlStatus, type Pack, type PackParam, type PackGuide,
} from "../persistence/apiClient.js";
import {
  STATUS_ORDER, STATUS_LABEL, MATURITY_LEVELS, maturityColour, themeColor,
} from "./format.js";

/**
 * One control, in full.
 *
 * The register edits status and owner in place, because that is the bulk of
 * day-to-day work. Everything else about a control lives here — including the
 * fields that differ per product, which are shown or hidden by the pack's
 * feature flags rather than by three separate components.
 */

export const PRIORITIES = ["", "High", "Medium", "Low"] as const;

interface Draft {
  status: ControlStatus;
  maturity: number | null;
  target_maturity: number | null;
  due_date: string | null;
  owner_email: string;
  owner: string;
  notes: string;
  mapped: string;
  justification: string;
  attrs: Record<string, unknown>;
}

const toDraft = (c: Control): Draft => ({
  status: c.status,
  maturity: c.maturity,
  target_maturity: c.target_maturity,
  due_date: c.due_date,
  owner_email: c.owner_email ?? "",
  owner: c.owner,
  notes: c.notes,
  mapped: c.mapped,
  justification: c.justification,
  attrs: { ...c.attrs },
});

export function ControlDetail({ control, pack, canEdit, onClose, onSaved, initialFix }: {
  control: Control;
  pack: Pack;
  canEdit: boolean;
  /** Opened from a link that names what to fix: select that box, or open the risk picker. */
  initialFix?: FixTarget | "";
  onClose: () => void;
  onSaved: (updated: Control) => void;
}): VNode {
  const [draft, setDraft] = useState<Draft>(toDraft(control));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [params, setParams] = useState<PackParam[]>([]);
  const [guide, setGuide] = useState<PackGuide | null>(null);

  /**
   * Organisation-defined parameters are framework content, so they come from
   * the pack; only the values belong to the customer. Fetched lazily, because
   * the file is large and two of the three products never need it.
   */
  useEffect(() => {
    if (!pack.features?.["parameters"]) return;
    let live = true;
    packApi
      .parameters()
      .then((all) => live && setParams(all[control.ref] ?? []))
      .catch(() => { /* the rest of the dialog still works */ });
    return () => { live = false; };
  }, [control.ref, pack.features]);

  /**
   * What this control means, in plain words, and what to do about it.
   *
   * Every pack carries this, and it is shown beside the control rather than
   * left in a file nobody opens: the customer who most needs the product is
   * the one who cannot already explain the control. It was once shown only
   * where controls are scored for maturity, which left three products with
   * explanations written and never seen. Fetched on demand for the same reason
   * as the parameters above: it is a whole-framework file to answer a
   * one-control question.
   */
  useEffect(() => {
    let live = true;
    packApi
      .guide()
      .then((all) => live && setGuide(all[control.ref] ?? null))
      .catch(() => { /* the rest of the dialog still works */ });
    return () => { live = false; };
  }, [control.ref, pack.features]);

  const f = pack.features ?? {};
  const defaultTarget = 3;
  const target = draft.target_maturity ?? defaultTarget;
  /**
   * Excluded items hide their score rather than keeping a stale one on screen.
   *
   * The number is left in the database on purpose: somebody who excludes a
   * subdomain and then changes their mind gets their assessment back instead
   * of redoing it. It is simply out of every figure while the exclusion
   * stands, which is what the summary already does.
   */
  const excluded = draft.status === "not_applicable";
  const set = (patch: Partial<Draft>): void => setDraft((d) => ({ ...d, ...patch }));
  const setAttr = (key: string, value: unknown): void =>
    setDraft((d) => ({ ...d, attrs: { ...d.attrs, [key]: value } }));

  /**
   * Parameters must merge against the *current* draft, not against whatever the
   * values were when this handler was created. Spreading a captured snapshot
   * loses every edit made since the last render — with eight parameters on a
   * single control, that is easy to hit and silent when it happens.
   */
  const setParam = (id: string, value: string): void =>
    setDraft((d) => ({
      ...d,
      attrs: {
        ...d.attrs,
        paramValues: { ...((d.attrs["paramValues"] as Record<string, string>) ?? {}), [id]: value },
      },
    }));
  const attr = (key: string): string => String(draft.attrs[key] ?? "");

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { control: updated } = await controls.update(control.id, draft);
      onSaved(updated);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ro = !canEdit;

  /** Takes someone to the place a fix is made: a field here, or the Golden thread. */
  // Bumped when evidence or a test changes here, so the checks follow without a click.
  const [fixKey, setFixKey] = useState(0);
  const bumpFix = (): void => setFixKey((n) => n + 1);
  const goFix = (where: FixTarget): void => {
    if (where === "thread") {
      onClose();
      window.location.hash = "#/risks/thread";
      return;
    }
    const el = document.querySelector<HTMLElement>(`.modal [data-fix="${where}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    if (el && "focus" in el) el.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (initialFix && initialFix !== "risks") focusFix(initialFix);
  }, []);

  /**
   * The same column, called what each framework calls it. ISO asks for a
   * Statement of Applicability rationale; 800-53 calls it tailoring; elsewhere
   * it is only ever filled in to explain an exclusion.
   */
  const justification = f["statementOfApplicability"]
    ? {
        label: "Justification for inclusion or exclusion",
        hint: "Required for anything excluded. An auditor will read this one first.",
      }
    : f["baselines"]
      ? {
          label: "Tailoring rationale",
          hint: "Why this control was added, removed or adjusted against the baseline.",
        }
      : { label: "Why this is not applicable", hint: "" };

  return html`
    <${Modal}
      title=${`${control.ref} — ${control.title}`}
      submitLabel="Save changes"
      busy=${busy}
      error=${error}
      onClose=${onClose}
      onSubmit=${submit}
    >
      <div class="detail-head">
        <span class="ref" style=${`border-color:${themeColor(control.theme)};color:${themeColor(control.theme)}`}>
          ${control.ref}
        </span>
        <span class="muted">${control.theme}</span>
        ${control.parent_ref
          ? html`<span class="muted">enhancement of ${control.parent_ref}</span>`
          : null}
        ${draft.attrs["inBaseline"] === true
          ? html`<span class="pill green">in baseline</span>`
          : draft.attrs["inBaseline"] === false
          ? html`<span class="pill slate">outside baseline</span>`
          : null}
      </div>

      <${ControlFix} controlId=${control.id} controlRef=${control.ref} refresh=${fixKey} canEdit=${canEdit}
        autoLink=${initialFix === "risks"}
        features=${f} target=${target} onFix=${goFix}
        draft=${{ status: draft.status, owner: draft.owner, justification: draft.justification,
                  due_date: draft.due_date, maturity: draft.maturity }} />

      ${guide
        ? html`<div class="guide-panel">
            ${guide.o ? html`<p class="guide-lede"><b>What this is.</b> ${guide.o}</p>` : null}
            ${guide.l3
              ? html`<p><b>What level ${defaultTarget} looks like.</b> ${guide.l3}</p>`
              : null}
            ${guide.a ? html`<p><b>What to do.</b> ${guide.a}</p>` : null}
            ${guide.r ? html`<p><b>Records to keep.</b> ${guide.r}</p>` : null}
            ${guide.e ? html`<p class="muted">${guide.e}</p>` : null}
            ${guide.s
              ? html`<details class="guide-source">
                  <summary>The framework's own wording</summary>
                  <p class="muted">${guide.s}</p>
                </details>`
              : null}
          </div>`
        : null}

      <div class="form-grid">
        ${f["maturity"]
          ? html`
              <${Field} label="Does this apply to you?"
                        hint="Exclude only what genuinely is not yours. An exclusion needs a reason.">
                <select value=${excluded ? "no" : "yes"} disabled=${ro}
                        onChange=${(e: Event) =>
                          set({
                            status:
                              (e.target as HTMLSelectElement).value === "no"
                                ? "not_applicable"
                                : "not_started",
                          })}>
                  <option value="yes">Yes, it applies</option>
                  <option value="no">No, it does not apply to us</option>
                </select>
              <//>`
          : null}

        ${f["maturity"] && !excluded
          ? html`
              <${Field} label="Maturity level"
                        hint=${draft.maturity === null
                          ? "Nobody has assessed this yet."
                          : MATURITY_LEVELS[draft.maturity]?.note ?? ""}>
                <select value=${draft.maturity === null ? "" : String(draft.maturity)}
                        disabled=${ro} data-fix="maturity"
                        style=${`border-color:${maturityColour(draft.maturity, target)}`}
                        onChange=${(e: Event) => {
                          const v = (e.target as HTMLSelectElement).value;
                          set({ maturity: v === "" ? null : Number(v) });
                        }}>
                  <option value="">Not scored</option>
                  ${MATURITY_LEVELS.map(
                    (l) => html`<option value=${String(l.level)}>${l.level} · ${l.name}</option>`,
                  )}
                </select>
              <//>
              <${Field} label="Target level"
                        hint=${`SAMA expects level ${defaultTarget} or above.`}>
                <select value=${String(target)} disabled=${ro}
                        onChange=${(e: Event) =>
                          set({ target_maturity: Number((e.target as HTMLSelectElement).value) })}>
                  ${MATURITY_LEVELS.map(
                    (l) => html`<option value=${String(l.level)}>${l.level} · ${l.name}</option>`,
                  )}
                </select>
              <//>`
          : f["maturity"]
            ? null
            : html`<${Field} label="Status">
              <select value=${draft.status} disabled=${ro} data-fix="status"
                      onChange=${(e: Event) =>
                        set({ status: (e.target as HTMLSelectElement).value as ControlStatus })}>
                ${STATUS_ORDER.map((s) => html`<option value=${s}>${STATUS_LABEL[s]}</option>`)}
              </select>
            <//>`}
        <${Field} label="Owner">
          <input value=${draft.owner} disabled=${ro} data-fix="owner"
                 onInput=${(e: Event) => set({ owner: (e.target as HTMLInputElement).value })} />
        <//>

        ${/*
            The two fields that make the product chase somebody. Deliberately
            side by side: one without the other does nothing, and seeing them
            together is what makes that obvious.
        */ null}
        <${Field} label="Due by"
                  hint="When this should be done. Leave blank and nobody is chased.">
          <input type="date" value=${draft.due_date ?? ""} disabled=${ro} data-fix="due"
                 onInput=${(e: Event) => {
                   const v = (e.target as HTMLInputElement).value;
                   set({ due_date: v === "" ? null : v });
                 }} />
        <//>

        <${Field} label="Email reminders to"
                  hint=${draft.due_date
                    ? "A reminder goes out when the date is close, and again once it has passed."
                    : "Add a due date as well, or nothing is sent."}>
          <input type="email" value=${draft.owner_email} disabled=${ro}
                 placeholder="name@yourcompany.com"
                 onInput=${(e: Event) =>
                   set({ owner_email: (e.target as HTMLInputElement).value })} />
        <//>

        ${f["priorities"]
          ? html`<${Field} label="Priority" hint="Used to rank the gap to your target profile.">
              <select value=${attr("priority")} disabled=${ro}
                      onChange=${(e: Event) =>
                        setAttr("priority", (e.target as HTMLSelectElement).value)}>
                ${PRIORITIES.map((p) => html`<option value=${p}>${p || "—"}</option>`)}
              </select>
            <//>`
          : null}

        ${f["origination"]
          ? html`<${Field} label="Control origination"
                   hint="Who actually implements it — you, the provider, or both.">
              <select value=${attr("origination")} disabled=${ro}
                      onChange=${(e: Event) =>
                        setAttr("origination", (e.target as HTMLSelectElement).value)}>
                ${["", "System specific", "Inherited", "Hybrid", "Common", "Not applicable"].map(
                  (o) => html`<option value=${o}>${o || "—"}</option>`,
                )}
              </select>
            <//>`
          : null}

        ${f["profiles"]
          ? html`
              <${Field} label="Current profile" wide=${true}
                        hint="How this outcome is handled today. Leave blank if it is not addressed yet.">
                <textarea rows="2" disabled=${ro} value=${attr("curState")}
                  onInput=${(e: Event) => setAttr("curState", (e.target as HTMLTextAreaElement).value)}
                ></textarea>
              <//>
              <${Field} label="Target profile" wide=${true}
                        hint="Where you want this outcome to be.">
                <textarea rows="2" disabled=${ro} value=${attr("tgtState")}
                  onInput=${(e: Event) => setAttr("tgtState", (e.target as HTMLTextAreaElement).value)}
                ></textarea>
              <//>`
          : null}

        ${f["baselines"] || f["statementOfApplicability"] || draft.status === "not_applicable"
          ? html`<${Field} label=${justification.label} hint=${justification.hint} wide=${true}>
              <textarea rows="2" disabled=${ro} value=${draft.justification} data-fix="justification"
                onInput=${(e: Event) => set({ justification: (e.target as HTMLTextAreaElement).value })}
              ></textarea>
            <//>`
          : null}

        ${f["parameters"] && params.length
          ? html`<div class="params wide">
              <div class="params-head">
                Organisation-defined parameters
                <span class="muted">${params.length} on this control</span>
              </div>
              ${params.map((prm) => {
                const values = (draft.attrs["paramValues"] as Record<string, string>) ?? {};
                return html`
                  <label class="param">
                    <span class="param-id">${prm.label}</span>
                    ${prm.hint ? html`<span class="param-hint muted">${prm.hint}</span>` : null}
                    ${prm.sel?.choices?.length
                      ? html`<select disabled=${ro} value=${values[prm.id] ?? ""}
                          onChange=${(e: Event) =>
                            setParam(prm.id, (e.target as HTMLSelectElement).value)}>
                          <option value="">—</option>
                          ${prm.sel.choices.map((c) => html`<option value=${c}>${c}</option>`)}
                        </select>`
                      : html`<input disabled=${ro} value=${values[prm.id] ?? ""}
                          placeholder="Not yet defined"
                          onInput=${(e: Event) =>
                            setParam(prm.id, (e.target as HTMLInputElement).value)} />`}
                  </label>`;
              })}
            </div>`
          : null}

        ${f["parameters"]
          ? html`<${Field} label="Implementation statement" wide=${true}
                   hint="How this control is actually satisfied in this system.">
              <textarea rows="3" disabled=${ro} value=${attr("implStatement")}
                onInput=${(e: Event) => setAttr("implStatement", (e.target as HTMLTextAreaElement).value)}
              ></textarea>
            <//>`
          : null}

        <${Field} label="Notes" wide=${true}>
          <textarea rows="3" disabled=${ro} value=${draft.notes}
            onInput=${(e: Event) => set({ notes: (e.target as HTMLTextAreaElement).value })}
          ></textarea>
        <//>

        <${Field} label="Cross-framework reference" wide=${true}
                  hint="Where this maps in another framework, if you track that.">
          <input value=${draft.mapped} disabled=${ro}
                 onInput=${(e: Event) => set({ mapped: (e.target as HTMLInputElement).value })} />
        <//>

        ${/*
            Outside the form on purpose. Evidence saves the moment it is
            attached, rather than waiting for the dialog's Save, because a
            half-finished upload that vanishes when somebody presses Cancel is
            the worst possible behaviour for the one thing an assessor asks for.
        */ null}
        <div class="wide" data-fix="evidence" tabindex="-1">
          <${ControlEvidence} controlId=${control.id} controlRef=${control.ref}
                              canEdit=${canEdit} onChange=${bumpFix} />
        </div>

        ${f["controlTesting"]
          ? html`<div class="wide" style="margin-top:12px" data-fix="tests" tabindex="-1">
              <${ControlTests} controlId=${control.id} canEdit=${canEdit} onChange=${bumpFix} />
            </div>`
          : null}
      </div>
    <//>`;
}
