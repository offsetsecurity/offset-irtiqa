import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { bar } from "./charts.js";
import { programme, controls, type Programme, type Control } from "../persistence/apiClient.js";
import { pct } from "./format.js";

/**
 * System and baseline — Anchor's programme screen.
 *
 * SP 800-53 starts from an impact level and the baseline that goes with it, so
 * this is the screen someone visits first: describe the system, pick the
 * baseline, and the 1,014 controls are scoped accordingly in one operation.
 */

const LEVELS = [
  {
    key: "low" as const,
    label: "Low",
    blurb: "Loss would have a limited adverse effect on operations, assets or individuals.",
  },
  {
    key: "moderate" as const,
    label: "Moderate",
    blurb: "Loss would have a serious adverse effect — significant damage, harm or financial loss.",
  },
  {
    key: "high" as const,
    label: "High",
    blurb: "Loss would have a severe or catastrophic effect, including loss of life or major harm.",
  },
];

const SYSTEM_FIELDS = [
  { key: "name", label: "System name", kind: "text" },
  { key: "ao", label: "Authorising official", kind: "text" },
  { key: "atoIssue", label: "Authorisation issued", kind: "date" },
  { key: "atoExpiry", label: "Authorisation expires", kind: "date" },
  { key: "description", label: "Description", kind: "textarea", wide: true },
  { key: "boundary", label: "Authorisation boundary", kind: "textarea", wide: true },
] as const;

type SystemDetails = Record<string, string>;

export function Baseline({ canEdit, itemLabel }: {
  canEdit: boolean;
  itemLabel: string;
}): VNode {
  const [prog, setProg] = useState<Programme | null>(null);
  const [rows, setRows] = useState<Control[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState("");
  const [confirming, setConfirming] = useState<"low" | "moderate" | "high" | null>(null);

  async function reload(): Promise<void> {
    const [p, c] = await Promise.all([programme.get(), controls.list()]);
    setProg(p);
    setRows(c.controls);
  }

  useEffect(() => {
    let live = true;
    Promise.all([programme.get(), controls.list()])
      .then(([p, c]) => {
        if (!live) return;
        setProg(p);
        setRows(c.controls);
      })
      .catch((err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  if (error && !prog) return html`<div class="card pad err">${error}</div>`;
  if (!prog) return html`<div class="card pad muted">Loading…</div>`;

  const system = (prog.attrs["system"] as SystemDetails | undefined) ?? {};
  const current = String(prog.attrs["baseline"] ?? "");

  const saveSystem = async (key: string, value: string): Promise<void> => {
    try {
      setProg(await programme.update({ attrs: { system: { ...system, [key]: value } } }));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  async function apply(level: "low" | "moderate" | "high"): Promise<void> {
    setBusy(true);
    setConfirming(null);
    try {
      const result = await programme.applyBaseline(level);
      await reload();
      setApplied(
        `${result.selected} ${itemLabel.toLowerCase()}s in the ${level} baseline, ` +
          `${result.excluded} marked not applicable` +
          (result.restored ? `, ${result.restored} brought back into scope` : "") +
          ".",
      );
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inScope = rows.filter((c) => c.status !== "not_applicable");
  const implemented = inScope.filter((c) => c.status === "implemented").length;
  const withParams = rows.filter(
    (c) => Object.keys((c.attrs["paramValues"] as object | undefined) ?? {}).length > 0,
  ).length;
  const stated = rows.filter((c) => String(c.attrs["implStatement"] ?? "").trim()).length;

  return html`<>
    <div class="card pad">
      <div class="section-title"><h2>System</h2></div>
      <div class="form-grid">
        ${SYSTEM_FIELDS.map((f) => html`
          <label class=${`fld${"wide" in f && f.wide ? " wide" : ""}`}>
            <span>${f.label}</span>
            ${f.kind === "textarea"
              ? html`<textarea rows="2" disabled=${!canEdit} value=${system[f.key] ?? ""}
                  onBlur=${(e: Event) => {
                    const v = (e.target as HTMLTextAreaElement).value;
                    if (v !== (system[f.key] ?? "")) void saveSystem(f.key, v);
                  }}
                ></textarea>`
              : html`<input type=${f.kind === "date" ? "date" : "text"} disabled=${!canEdit}
                  value=${system[f.key] ?? ""}
                  onBlur=${(e: Event) => {
                    const v = (e.target as HTMLInputElement).value;
                    if (v !== (system[f.key] ?? "")) void saveSystem(f.key, v);
                  }}
                />`}
          </label>`)}
      </div>
    </div>

    <div class="card pad" style="margin-top:16px">
      <div class="section-title">
        <h2>Security control baseline</h2>
        <span class="muted" style="font-size:12px">SP 800-53B</span>
      </div>
      <p class="muted" style="margin:0 0 16px;max-width:75ch;font-size:12.5px">
        Choosing a baseline scopes the whole catalogue in one go. Anything outside it is
        marked not applicable with the reason recorded. A rationale you wrote yourself is
        never overwritten, and switching to a wider baseline brings controls back into scope.
      </p>

      ${error ? html`<div class="err" role="alert">${error}</div>` : null}
      ${applied ? html`<div class="notice">${applied}</div>` : null}

      <div class="baseline-grid">
        ${LEVELS.map((l) => html`
          <div class=${`baseline-tile${current === l.key ? " current" : ""}`}>
            <div class="baseline-name">${l.label}</div>
            <p class="muted">${l.blurb}</p>
            ${current === l.key
              ? html`<span class="pill green">applied</span>`
              : canEdit
              ? html`<button class="btn" disabled=${busy}
                        onClick=${() => setConfirming(l.key)}>
                  Apply ${l.label.toLowerCase()}
                </button>`
              : null}
          </div>`)}
      </div>

      ${confirming
        ? html`<div class="confirm">
            <div>
              Applying the <b>${confirming}</b> baseline will re-scope all
              ${rows.length} ${itemLabel.toLowerCase()}s. Statuses of excluded
              ${itemLabel.toLowerCase()}s are set to not applicable.
            </div>
            <div class="confirm-actions">
              <button class="btn" onClick=${() => setConfirming(null)}>Cancel</button>
              <button class="btn primary" disabled=${busy}
                      onClick=${() => void apply(confirming)}>
                ${busy ? "Applying…" : `Apply the ${confirming} baseline`}
              </button>
            </div>
          </div>`
        : null}
    </div>

    <div class="grid two" style="margin-top:16px">
      <div class="card pad">
        <div class="section-title"><h2>Scope</h2></div>
        <div class="fn-body" style="margin-bottom:14px">
          <div class="fn-head"><span>In the baseline</span><b>${inScope.length}</b></div>
          ${bar(pct(inScope.length, rows.length), "#2457D6")}
          <div class="fn-note muted">${rows.length - inScope.length} outside it</div>
        </div>
        <div class="fn-body">
          <div class="fn-head"><span>Implemented</span><b>${pct(implemented, inScope.length)}%</b></div>
          ${bar(pct(implemented, inScope.length), "#16a34a")}
          <div class="fn-note muted">${implemented} of ${inScope.length} in scope</div>
        </div>
      </div>

      <div class="card pad">
        <div class="section-title"><h2>Tailoring</h2></div>
        <div class="fn-body" style="margin-bottom:14px">
          <div class="fn-head"><span>Parameters filled in</span><b>${withParams}</b></div>
          ${bar(pct(withParams, inScope.length), "#7c3aed")}
          <div class="fn-note muted">
            Organisation-defined parameters left blank read as "[Assignment: …]" in a report.
          </div>
        </div>
        <div class="fn-body">
          <div class="fn-head"><span>Implementation described</span><b>${stated}</b></div>
          ${bar(pct(stated, inScope.length), "#0891b2")}
          <div class="fn-note muted">${stated} of ${inScope.length} in scope</div>
        </div>
      </div>
    </div>
  </>`;
}
