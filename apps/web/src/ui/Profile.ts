import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { bar } from "./charts.js";
import { programme, controls, type Programme, type Control } from "../persistence/apiClient.js";
import { pct, plural } from "./format.js";

/**
 * Profile and Tiers — the screen that makes Align a CSF tool rather than a
 * checklist with CSF words on it.
 *
 * Tiers describe how an organisation goes about cybersecurity risk. They are
 * not a maturity score, and CSF 2.0 is explicit that a higher Tier is not
 * automatically better, so the wording here avoids implying it.
 */

const TIER_NAMES = [
  "Not set",
  "Tier 1 · Partial",
  "Tier 2 · Risk Informed",
  "Tier 3 · Repeatable",
  "Tier 4 · Adaptive",
];

const TIER_BLURB = [
  "",
  "Risk is managed ad hoc, with limited awareness and little coordination across the organisation.",
  "Risk practices are approved by management but are not established as organisation-wide policy.",
  "Practices are formally approved, expressed as policy, and updated as requirements change.",
  "The organisation adapts its practices from lessons learned and from predictive indicators.",
];

const DIMENSIONS = [
  {
    key: "gov",
    label: "Cybersecurity Risk Governance",
    hint: "How risk decisions are made, owned and overseen.",
  },
  {
    key: "rm",
    label: "Cybersecurity Risk Management",
    hint: "How risk is identified, treated and monitored day to day.",
  },
] as const;

type Tiers = Record<string, number | string | undefined>;

/** Four segments: solid up to current, outlined up to target. */
function tierBadge(current: number, target: number): VNode {
  return html`
    <div class="tier-badge">
      ${[1, 2, 3, 4].map((n) => {
        const at = n <= current;
        const wanted = n <= target;
        return html`<span class=${`tier-seg${at ? " at" : wanted ? " want" : ""}`}></span>`;
      })}
      <span class="muted tier-label">
        ${current ? TIER_NAMES[current] : "not set"}${target && target !== current
          ? ` → ${TIER_NAMES[target]}`
          : ""}
      </span>
    </div>`;
}

export function Profile({ canEdit, itemLabel }: {
  canEdit: boolean;
  itemLabel: string;
}): VNode {
  const [prog, setProg] = useState<Programme | null>(null);
  const [rows, setRows] = useState<Control[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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

  if (error) return html`<div class="card pad err">${error}</div>`;
  if (!prog) return html`<div class="card pad muted">Loading…</div>`;

  const tiers = (prog.attrs["tiers"] as Tiers | undefined) ?? {};
  const tier = (key: string): number => Number(tiers[key] ?? 0);

  async function saveTiers(patch: Record<string, unknown>): Promise<void> {
    setSaving(true);
    try {
      const next = await programme.update({ attrs: { tiers: { ...tiers, ...patch } } });
      setProg(next);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Target-profile progress, measured over what is actually in scope.
  const inScope = rows.filter((c) => c.status !== "not_applicable");
  const implemented = inScope.filter((c) => c.status === "implemented").length;
  const inProgress = inScope.filter((c) => c.status === "in_progress").length;
  const notStarted = inScope.length - implemented - inProgress;

  const gaps = inScope.filter((c) => c.status !== "implemented");
  const byPriority = (name: string): number =>
    gaps.filter((c) => String(c.attrs["priority"] ?? "") === name).length;
  const unranked = gaps.filter((c) => !c.attrs["priority"]).length;

  const described = rows.filter((c) => String(c.attrs["curState"] ?? "").trim()).length;
  const targeted = rows.filter((c) => String(c.attrs["tgtState"] ?? "").trim()).length;
  const items = plural(itemLabel).toLowerCase();

  const segment = (n: number, colour: string, title: string): VNode | null =>
    n > 0
      ? html`<div style=${`flex:${n};background:${colour}`} title=${`${title}: ${n}`}></div>`
      : null;

  return html`<>
    <div class="card pad">
      <div class="section-title">
        <h2>Framework Tiers</h2>
        <span class="muted" style="font-size:12px">current → target${saving ? " · saving…" : ""}</span>
      </div>
      <p class="muted" style="margin:0 0 18px;max-width:70ch;font-size:12.5px">
        Tiers describe how you go about managing cybersecurity risk. They are not a
        score, and a higher Tier is not automatically the right answer. Pick the
        target that suits the risk you actually carry.
      </p>

      ${DIMENSIONS.map((d) => html`
        <div class="tier-row">
          <div class="tier-head">
            <div>
              <div class="tier-name">${d.label}</div>
              <div class="muted" style="font-size:11.5px">${d.hint}</div>
            </div>
            ${tierBadge(tier(`${d.key}Cur`), tier(`${d.key}Tgt`))}
          </div>
          <div class="tier-selects">
            <label>
              <span class="muted">Current</span>
              <select disabled=${!canEdit} value=${String(tier(`${d.key}Cur`))}
                      onChange=${(e: Event) =>
                        void saveTiers({ [`${d.key}Cur`]: Number((e.target as HTMLSelectElement).value) })}>
                ${TIER_NAMES.map((n, i) => html`<option value=${i}>${n}</option>`)}
              </select>
            </label>
            <label>
              <span class="muted">Target</span>
              <select disabled=${!canEdit} value=${String(tier(`${d.key}Tgt`))}
                      onChange=${(e: Event) =>
                        void saveTiers({ [`${d.key}Tgt`]: Number((e.target as HTMLSelectElement).value) })}>
                ${TIER_NAMES.map((n, i) => html`<option value=${i}>${n}</option>`)}
              </select>
            </label>
          </div>
          ${tier(`${d.key}Cur`)
            ? html`<p class="tier-blurb muted">${TIER_BLURB[tier(`${d.key}Cur`)]}</p>`
            : null}
        </div>`)}

      <label class="fld" style="margin:6px 0 0">
        <span>Notes on your Tier choice</span>
        <textarea rows="2" disabled=${!canEdit} value=${String(tiers["note"] ?? "")}
          onBlur=${(e: Event) => {
            const value = (e.target as HTMLTextAreaElement).value;
            if (value !== String(tiers["note"] ?? "")) void saveTiers({ note: value });
          }}
        ></textarea>
      </label>
    </div>

    <div class="grid two" style="margin-top:16px">
      <div class="card pad">
        <div class="section-title"><h2>Target profile progress</h2></div>
        <div class="stack-bar">
          ${segment(implemented, "#16a34a", "At target")}
          ${segment(inProgress, "#d97706", "In progress")}
          ${segment(notStarted, "#cbd5e1", "Not started")}
        </div>
        <div class="legend" style="flex-direction:row;gap:18px;margin-top:10px">
          <div><span class="dot" style="background:#16a34a"></span>${implemented} at target</div>
          <div><span class="dot" style="background:#d97706"></span>${inProgress} in progress</div>
          <div><span class="dot" style="background:#cbd5e1"></span>${notStarted} not started</div>
        </div>

        <div class="section-title" style="margin:22px 0 12px"><h2>Profile written up</h2></div>
        <div class="fn-body" style="margin-bottom:14px">
          <div class="fn-head"><span>Current state described</span><b>${pct(described, rows.length)}%</b></div>
          ${bar(pct(described, rows.length), "#0891b2")}
          <div class="fn-note muted">${described} of ${rows.length} ${items}</div>
        </div>
        <div class="fn-body">
          <div class="fn-head"><span>Target state described</span><b>${pct(targeted, rows.length)}%</b></div>
          ${bar(pct(targeted, rows.length), "#2457D6")}
          <div class="fn-note muted">${targeted} of ${rows.length} ${items}</div>
        </div>
      </div>

      <div class="card pad">
        <div class="section-title">
          <h2>Gap to target, by priority</h2>
          <span class="muted" style="font-size:12px">${gaps.length} open</span>
        </div>
        <div class="pri-grid">
          ${[["High", "#dc2626"], ["Medium", "#d97706"], ["Low", "#475569"]].map(
            ([name, colour]) => html`
              <div class="pri-tile" style=${`--tile:${colour}`}>
                <div class="pri-n">${byPriority(name!)}</div>
                <div class="pri-l">${name}</div>
              </div>`,
          )}
          <div class="pri-tile" style="--tile:#94a3b8">
            <div class="pri-n">${unranked}</div>
            <div class="pri-l">Unranked</div>
          </div>
        </div>
        <p class="muted" style="font-size:12px;margin:14px 0 0">
          ${unranked
            ? `${unranked} open ${items} have no priority set. Open one from the register to rank it.`
            : "Every open item has been ranked."}
        </p>
      </div>
    </div>
  </>`;
}
