import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { thread, controls, risks as risksApi, type ControlThread, type ControlStatus, type Risk } from "../persistence/apiClient.js";
import { LinkPicker } from "./LinkPicker.js";

/**
 * "How to fix this": the Golden thread, for one control.
 *
 * The thread shows breaks across the whole programme. Someone working through
 * the control register needs the same verdict for the control in front of
 * them, with the next step beside each problem. The facts that live elsewhere
 * (the risks it treats, its evidence, its tests) come from the server; the
 * rest is read from the form as it is being edited, so a fix shows as fixed
 * the moment it is typed, before Save.
 *
 * The rules are the thread's: a control nobody owns, with no evidence, or with
 * evidence older than the thread's limit, is a break an auditor will find.
 */

/** Where a fix is made: a field in this window, or another screen. */
export type FixTarget = "owner" | "status" | "maturity" | "due" | "justification" | "evidence" | "tests" | "thread" | "risks";

interface Check {
  level: "bad" | "weak" | "ok";
  text: string;
  fix?: string;
  target?: FixTarget;
}

export interface FixDraft {
  status: ControlStatus;
  owner: string;
  justification: string;
  due_date: string | null;
  maturity: number | null;
}

export function ControlFix({ controlId, controlRef, refresh = 0, canEdit = true, autoLink = false, draft, features, target, onFix }: {
  controlId: string;
  controlRef: string;
  /** Changes whenever evidence or a test is added or removed in this window. */
  refresh?: number;
  canEdit?: boolean;
  /** Open the risk picker as soon as the checks have loaded. */
  autoLink?: boolean;
  draft: FixDraft;
  features: Record<string, boolean>;
  /** The maturity level a control is meant to reach, where the product scores maturity. */
  target: number;
  onFix: (where: FixTarget) => void;
}): VNode | null {
  const [facts, setFacts] = useState<ControlThread | null>(null);
  const [tick, setTick] = useState(0);
  // "" until the first manual check; then "checking", then "done".
  const [checked, setChecked] = useState<"" | "checking" | "done">("");
  // Linking risks to this control, right here rather than from the risk register.
  const [linking, setLinking] = useState(false);
  const [allRisks, setAllRisks] = useState<Risk[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [linkError, setLinkError] = useState("");

  const startLinking = (): void => {
    if (!canEdit || !facts) return;
    setPicked(facts.risks.map((r) => r.id));
    setLinkError("");
    setLinking(true);
    if (!allRisks) risksApi.list().then(({ risks }) => setAllRisks(risks)).catch((e: Error) => setLinkError(e.message));
  };
  const saveLinks = async (): Promise<void> => {
    setSaving(true);
    setLinkError("");
    try {
      await controls.setRisks(controlId, picked);
      setLinking(false);
      setTick((n) => n + 1);
    } catch (e) {
      setLinkError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    let live = true;
    thread.control(controlId)
      .then((t) => { if (live) { setFacts(t); setChecked((c) => (c === "checking" ? "done" : c)); } })
      .catch(() => { if (live) { setFacts(null); setChecked(""); } });
    return () => { live = false; };
  }, [controlId, tick, refresh]);

  // A link that says "link its risks" opens the picker once, when the facts arrive.
  const [autoLinked, setAutoLinked] = useState(false);
  useEffect(() => {
    if (autoLink && facts && !autoLinked) { setAutoLinked(true); startLinking(); }
  }, [autoLink, facts, autoLinked]);

  if (!facts) return null;

  const excluded = draft.status === "not_applicable";
  const checks: Check[] = [];
  const risks = facts.risks.length;
  const fresh = facts.evidence.filter((e) => e.ageDays !== null && e.ageDays <= facts.staleDays).length;

  if (excluded) {
    checks.push(draft.justification.trim()
      ? { level: "ok", text: "Excluded, and the reason is written down." }
      : { level: "bad", text: "Excluded without a reason. An auditor asks why first.", fix: "Write the reason", target: "justification" });
    if (risks) {
      checks.push({
        level: "bad",
        text: `Excluded, but ${risks} risk${risks === 1 ? "" : "s"} rel${risks === 1 ? "ies" : "y"} on it: ${facts.risks.map((r) => `#${r.seq}`).join(", ")}.`,
        fix: "Change the linked risks", target: "risks",
      });
    }
  } else {
    checks.push(draft.owner.trim()
      ? { level: "ok", text: `Owned by ${draft.owner.trim()}.` }
      : { level: "bad", text: "Nobody owns it, so nobody is accountable for it.", fix: "Name an owner", target: "owner" });

    if (features["maturity"]) {
      if (draft.maturity === null) {
        checks.push({ level: "weak", text: "Not assessed yet: no maturity level.", fix: "Score it", target: "maturity" });
      } else if (draft.maturity < target) {
        checks.push({ level: "weak", text: `At level ${draft.maturity}, below the target of ${target}.`, fix: "Plan the work to close the gap", target: "due" });
      } else {
        checks.push({ level: "ok", text: `At level ${draft.maturity}, meeting the target of ${target}.` });
      }
    } else if (draft.status === "not_started") {
      checks.push({ level: "weak", text: "Not started.", fix: "Set it to In progress when work begins", target: "status" });
    } else {
      checks.push({ level: "ok", text: draft.status === "implemented" ? "Marked as implemented." : "In progress." });
    }

    checks.push(risks
      ? { level: "ok", text: `Treats ${risks} risk${risks === 1 ? "" : "s"}: ${facts.risks.map((r) => r.title).slice(0, 3).join("; ")}${risks > 3 ? "…" : ""}.` }
      : { level: "weak", text: "Not linked to any risk, so nothing shows why you need it.", fix: "Link it to the risks it treats", target: "risks" });

    const done = draft.status === "implemented" || (draft.maturity !== null && draft.maturity >= 3);
    if (!facts.evidence.length) {
      checks.push({
        level: done ? "bad" : "weak",
        text: done ? "Marked as in place, with nothing to prove it." : "No evidence attached yet.",
        fix: "Attach evidence", target: "evidence",
      });
    } else if (!fresh) {
      checks.push({
        level: "weak",
        text: `All its evidence is older than ${facts.staleDays} days, or has no date.`,
        fix: "Attach something recent", target: "evidence",
      });
    } else {
      checks.push({ level: "ok", text: `${fresh} piece${fresh === 1 ? "" : "s"} of recent evidence.` });
    }

    if (features["statementOfApplicability"] && !draft.justification.trim()) {
      checks.push({ level: "weak", text: "No reason given for including it in the Statement of Applicability.", fix: "Write why it applies", target: "justification" });
    }
    if (features["controlTesting"]) {
      checks.push(facts.tests.count
        ? { level: "ok", text: `Tested ${facts.tests.count} time${facts.tests.count === 1 ? "" : "s"}, last on ${facts.tests.last}.` }
        : { level: "weak", text: "Never tested.", fix: "Record a test", target: "tests" });
    }
    if (!done && !draft.due_date) {
      checks.push({ level: "weak", text: "No due date, so nobody is reminded.", fix: "Set a due date", target: "due" });
    }
  }

  const open = checks.filter((c) => c.level !== "ok");
  const order = { bad: 0, weak: 1, ok: 2 };
  checks.sort((a, b) => order[a.level] - order[b.level]);

  // The thread strip: what this control treats, the control, and what proves it.
  const owned = Boolean(draft.owner.trim());
  const whole = !excluded && risks > 0 && owned && fresh > 0;
  const shownRisks = facts.risks.slice(0, 3);
  const shownEvidence = facts.evidence.slice(0, 3);
  const age = (d: number | null): string => (d === null ? "no date" : d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"} old`);
  const strip = html`<div class="thread-strip">
    <div class="ts-head">
      <span>Golden thread</span>
      <span class=${excluded ? "ts-state" : whole ? "ts-state ok" : "ts-state bad"}>
        ${excluded ? "Excluded" : whole ? "Thread whole" : "Thread broken"}</span>
    </div>
    <div class="ts-row">
      <div class="ts-col">
        <div class="ts-cap">Risks it treats</div>
        ${shownRisks.length
          ? shownRisks.map((r) => html`<div class="ts-chip ok" key=${r.id}>#${r.seq} ${r.title}</div>`)
          : html`<button type="button" class=${`ts-chip ${excluded ? "" : "bad"}`} onClick=${startLinking}>
              No risk linked<small>${canEdit ? "Link a risk" : "Not linked yet"}</small></button>`}
        ${risks > 3 ? html`<div class="ts-more">and ${risks - 3} more</div>` : null}
        ${risks && canEdit && !linking
          ? html`<button type="button" class="linklike ts-edit" onClick=${startLinking}>Change linked risks</button>`
          : null}
      </div>
      <div class=${`ts-arrow${whole ? " ok" : excluded ? "" : " bad"}`} aria-hidden="true">→</div>
      <div class="ts-col">
        <div class="ts-cap">This control</div>
        ${excluded
          ? html`<div class="ts-ctl">${controlRef}<small>Not applicable</small></div>`
          : owned
          ? html`<div class="ts-ctl ok">${controlRef}<small>Owner: ${draft.owner.trim()}</small></div>`
          : html`<button type="button" class="ts-ctl bad" onClick=${() => onFix("owner")}>${controlRef}<small>No owner</small></button>`}
      </div>
      <div class=${`ts-arrow${whole ? " ok" : excluded ? "" : " bad"}`} aria-hidden="true">→</div>
      <div class="ts-col">
        <div class="ts-cap">Evidence</div>
        ${shownEvidence.length
          ? shownEvidence.map((e, i) => {
              const ok = e.ageDays !== null && e.ageDays <= facts.staleDays;
              return html`<button type="button" key=${i} class=${`ts-chip ${ok ? "ok" : "bad"}`} onClick=${() => onFix("evidence")}>
                ${e.name}<small>${age(e.ageDays)}</small></button>`;
            })
          : html`<button type="button" class=${`ts-chip ${excluded ? "" : "bad"}`} onClick=${() => onFix("evidence")}>
              Nothing attached<small>Attach evidence</small></button>`}
        ${facts.evidence.length > 3 ? html`<div class="ts-more">and ${facts.evidence.length - 3} more</div>` : null}
      </div>
    </div>
  </div>`;

  const riskOptions = (allRisks ?? []).map((r) => ({ id: r.id, label: `#${r.seq} ${r.title}`, detail: r.category }));
  const picker = linking
    ? html`<div class="ts-link">
        <b>Which risks does ${controlRef} treat?</b>
        <p class="muted">Tick every risk this control helps to reduce, or type a new one to add it. It is the
          same link as the Controls box on a risk, so the risk register shows it too.</p>
        ${allRisks === null && !linkError
          ? html`<p class="muted">Loading the risk register…</p>`
          : html`<${LinkPicker} options=${riskOptions} value=${picked} onChange=${setPicked}
              placeholder="Search risks, or type a new one…"
              empty="There are no risks in the register yet. Type one above to add it."
              create=${canEdit ? {
                label: (t: string) => `+ Add "${t}" as a new risk`,
                // Scored 3 × 3 to start; the owner scores it properly in the risk register.
                run: async (t: string) => {
                  const { risk } = await risksApi.create({ title: t, likelihood: 3, impact: 3 });
                  setAllRisks((cur) => [...(cur ?? []), risk]);
                  return risk.id;
                },
              } : undefined} />`}
        ${linkError ? html`<div class="err">${linkError}</div>` : null}
        <div class="ts-link-actions">
          <button type="button" class="btn small primary" disabled=${saving || allRisks === null} onClick=${() => void saveLinks()}>
            ${saving ? "Saving…" : "Save links"}</button>
          <button type="button" class="btn small" disabled=${saving} onClick=${() => setLinking(false)}>Cancel</button>
        </div>
      </div>`
    : null;

  return html`<div class=${`fix-panel${open.length ? "" : " all-ok"}`}>
    ${strip}
    ${picker}
    <div class="fix-head">
      <b>${open.length ? `How to fix this: ${open.length} thing${open.length === 1 ? "" : "s"} to do` : "Nothing to fix. The thread is whole for this control."}</b>
      <span class="fix-check">
        ${checked === "done" ? html`<span class="muted">Checked just now</span>` : null}
        <button type="button" class="linklike" disabled=${checked === "checking"}
                onClick=${() => { setChecked("checking"); setTick((n) => n + 1); }}>
          ${checked === "checking" ? "Checking…" : "Check again"}</button>
      </span>
    </div>
    <ul>
      ${checks.map((c, i) => html`<li key=${i} class=${c.level}>
        <span class="dot" aria-hidden="true"></span>
        <span class="what">${c.text}</span>
        ${c.fix && c.target
          ? html`<button type="button" class="btn small"
              onClick=${() => (c.target === "risks" ? startLinking() : onFix(c.target!))}>${c.fix}</button>`
          : null}
      </li>`)}
    </ul>
  </div>`;
}
