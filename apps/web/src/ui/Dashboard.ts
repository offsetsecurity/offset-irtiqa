import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { donut, radar, themeGrid, bar } from "./charts.js";
import { controls, risks, evidence, readiness, type Control, type Risk, type Pack, type ReadinessDashboard } from "../persistence/apiClient.js";
import { openWithStatus } from "./deepLink.js";
import { FlightPath, Forecast, Team } from "./ReadyDashboard.js";
import { HomeHero } from "./Home.js";
import {
  STATUS_ORDER, STATUS_LABEL, STATUS_COLOR, STATUS_PILL, RISK_BAND_COLOR, MATURITY_LEVELS,
  themeColor, pct, plural,
} from "./format.js";

type Summary = Awaited<ReturnType<typeof controls.summary>>;
type RiskSummary = Awaited<ReturnType<typeof risks.summary>>;
type EvidenceSummary = Awaited<ReturnType<typeof evidence.summary>>;

interface Data {
  controls: Summary;
  risks: RiskSummary;
  topRisks: Risk[];
  evidence: EvidenceSummary;
  /** In scope and not implemented yet: what is still to finish. */
  todo: Control[];
}

/**
 * One headline number, with a coloured spine and a line of context under it.
 *
 * Each card links to the screen its number came from, so the lift on hover is
 * an affordance rather than decoration — a card that rises under the cursor
 * and then does nothing is a promise it does not keep.
 */
function kpi(
  label: string,
  value: string | number,
  note: VNode | string,
  accent: string,
  goTo: string,
): VNode {
  return html`
    <a class="card pad stat kpi" href=${`#/${goTo}`} style=${`--accent:${accent}`}>
      <div class="go" aria-hidden="true">→</div>
      <div class="lbl">${label}</div>
      <div class="val">${value}</div>
      <div class="delta">${note}</div>
    </a>`;
}

export function Dashboard({ themes, themeLabel, itemLabel, pack, name = "" }: {
  name?: string;
  themes: Record<string, string>;
  themeLabel: string;
  itemLabel: string;
  pack: Pack;
}): VNode {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  /** The pack's `readiness` feature: the flight path, the auditor's eye, the forecast and the team. */
  const ready = Boolean(pack.features?.["readiness"]);
  const [readyData, setReadyData] = useState<ReadinessDashboard | null>(null);
  useEffect(() => {
    if (ready) readiness.dashboard().then(setReadyData).catch(() => setReadyData(null));
  }, [ready]);

  useEffect(() => {
    let live = true;
    Promise.all([controls.summary(), risks.summary(), risks.list(), evidence.summary(), controls.list()])
      .then(([c, r, list, e, all]) => {
        if (!live) return;
        const topRisks = [...list.risks].sort((a, b) => b.inherent - a.inherent).slice(0, 5);
        const rank = (x: Control): number => (x.status === "not_started" ? 0 : 1);
        const todo = all.controls
          .filter((x) => x.status === "in_progress" || x.status === "not_started")
          .sort((a, b) => rank(a) - rank(b) || a.ref.localeCompare(b.ref, undefined, { numeric: true }));
        setData({ controls: c, risks: r, topRisks, evidence: e, todo });
      })
      .catch((err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  if (error) return html`<div class="card pad err">${error}</div>`;
  if (!data) return html`<div class="card pad muted">Loading…</div>`;

  const { controls: cs, risks: rs, topRisks, evidence: ev, todo } = data;
  const m = cs.maturity;
  /**
   * Two figures rather than one, and they answer different questions.
   *
   * "82% at or above target" is the compliance answer SAMA asks for.
   * "average 3.4" is how far along the programme actually is. A programme
   * can sit at 100% of a target of 3 and still average 3.0, which is a fine
   * place to be and a poor place to stop.
   */
  const scoresMaturity = Boolean(pack.features?.["maturity"]);

  const themeKeys = Object.keys(themes).filter((k) => cs.byTheme[k]);

  const applicableIn = (key: string): number =>
    Object.entries(cs.byTheme[key] ?? {})
      .filter(([s]) => s !== "not_applicable")
      .reduce((a, [, n]) => a + n, 0);

  /**
   * How far along one domain is, as a percentage.
   *
   * Ticked frameworks: the share implemented. Scored ones: the share at or
   * above target. Both are "how much of this is done", which is what the bars
   * and the radar are asking, so one function answers for both rather than
   * drawing two sets of charts.
   */
  const readinessOf = (key: string): number => {
    if (scoresMaturity) {
      const t = m.byTheme[key];
      return t && t.scored ? pct(t.atTarget, t.scored) : 0;
    }
    return pct((cs.byTheme[key] ?? {})["implemented"] ?? 0, applicableIn(key));
  };

  const openRisks = rs.byStatus["Open"] ?? 0;
  const fresh = ev.byFreshness["fresh"] ?? 0;
  const stale = (ev.byFreshness["stale"] ?? 0) + (ev.byFreshness["due"] ?? 0);

  /**
   * Twenty 800-53 families would make this card a wall of rows and the radar a
   * scribble. Past ten, list only the weakest and switch the profile to a grid.
   */
  const crowded = themeKeys.length > 10;
  const listed = crowded
    ? themeKeys
        // A family with nothing applicable is out of scope, not behind. For a
        // scored framework the same is true of one nobody has assessed yet.
        .filter((k) => (scoresMaturity ? (m.byTheme[k]?.scored ?? 0) > 0 : applicableIn(k) > 0))
        .sort((a, b) => readinessOf(a) - readinessOf(b))
        .slice(0, 8)
    : themeKeys;

  /**
   * What the donut is counting.
   *
   * A maturity framework never sets a status, so slicing by status would show
   * everything sitting in "Not Started" for ever. The spread of levels is the
   * same question asked of the data that actually exists.
   */
  const LEVEL_COLOR = ["#97A0B1", "#D2333D", "#D75A12", "#C47A06", "#14915A", "#0f766e"];
  const statusSlices = scoresMaturity
    ? [
        ...MATURITY_LEVELS.map((l) => ({
          label: `${l.level} · ${l.name}`,
          value: m.byLevel[String(l.level)] ?? 0,
          color: LEVEL_COLOR[l.level] ?? "#97A0B1",
          onPick: () => openWithStatus(`level:${l.level}`),
        })),
        ...(m.unscored ? [{ label: "Not scored", value: m.unscored, color: "#D3D8E1", onPick: () => openWithStatus("unscored") }] : []),
      ]
    : STATUS_ORDER.map((s) => ({
        label: STATUS_LABEL[s],
        value: cs.byStatus[s] ?? 0,
        color: STATUS_COLOR[s],
        onPick: () => openWithStatus(s),
      }));
  const sliceTotal = statusSlices.reduce((a, x) => a + x.value, 0);
  /** Each line's share: of what is in scope for a status, of everything for a level. */
  const shareOf = (i: number): string => {
    const v = statusSlices[i]!.value;
    if (scoresMaturity) return `${pct(v, sliceTotal)}%`;
    return STATUS_ORDER[i] === "not_applicable" ? `of ${sliceTotal}` : `${pct(v, cs.applicable)}%`;
  };

  return html`<>
    <${HomeHero} name=${name} d=${readyData} words=${pack.readiness} pct=${scoresMaturity ? m.atTargetPct : cs.readinessPct}
      ringLabel=${scoresMaturity ? "at or above target" : "in place"}
      gaps=${scoresMaturity ? null : ev.controlsImplementedWithoutEvidence} journey=${Boolean(pack.features?.["journey"])} />
    ${ready && readyData
      ? html`<div class="sd-top">
          <${FlightPath} d=${readyData} words=${pack.readiness} showRing=${false}
            label=${pack.features?.["maturity"] ? "at or above target" : "controls in place"} />
        </div>`
      : null}
    <div class="grid cards">
      ${scoresMaturity
        ? html`<>
            ${kpi("At or above target", `${m.atTargetPct}%`,
              m.unscored
                ? html`<span style="color:var(--muted)">${m.scored} of ${m.total} scored so far</span>`
                : `${m.atTarget} of ${m.scored} ${plural(itemLabel).toLowerCase()} at level ${m.defaultTarget} or better`,
              "#183A8F", "controls")}
            ${kpi("Average maturity", m.scored ? m.average.toFixed(1) : "—",
              m.scored
                ? `across ${m.scored} scored ${plural(itemLabel).toLowerCase()}, out of 5`
                : "nothing scored yet",
              "#5546C8", "controls")}
          </>`
        : kpi("Profile readiness", `${cs.readinessPct}%`,
            `${cs.implemented} of ${cs.applicable} in-scope ${plural(itemLabel).toLowerCase()} implemented`,
            "#183A8F", "controls")}
      ${kpi("Open risks", openRisks,
        rs.byBand["critical"]
          ? html`<span style="color:var(--red)">${rs.byBand["critical"]} critical</span>`
          : `${rs.total} in the register`,
        "#B42830", "risks")}
      ${kpi("Evidence items", ev.total,
        stale ? html`<span style="color:var(--amber)">${stale} need refreshing</span>`
              : `${fresh} collected recently`,
        "#0f766e", "evidence")}
      ${scoresMaturity
        ? null
        : kpi("Evidence gaps", ev.controlsImplementedWithoutEvidence,
            ev.controlsImplementedWithoutEvidence
              ? html`<span style="color:var(--red)">implemented, nothing to prove it</span>`
              : "every implemented item has proof",
            ev.controlsImplementedWithoutEvidence ? "#A86405" : "#0f766e", "evidence")}
    </div>

    <div class="grid two" style="margin-top:16px">
      <div class="card pad">
        <div class="section-title">
          <h2>${themeLabel} readiness</h2>
          ${crowded
            ? html`<span class="muted" style="font-size:12px">
                weakest ${listed.length} of ${themeKeys.length}
              </span>`
            : null}
        </div>
        <div class="fn-rows">
          ${listed.map((key) => {
            const row = cs.byTheme[key] ?? {};
            const total = Object.values(row).reduce((a, n) => a + n, 0);
            const p = readinessOf(key);
            return html`
              <div class="fn-row">
                <div class="fn-key" style=${`color:${themeColor(key)}`}>${key}</div>
                <div class="fn-body">
                  <div class="fn-head">
                    <span>${themes[key]}</span>
                    <b>${p}%</b>
                  </div>
                  ${bar(p, themeColor(key))}
                  <div class="fn-note muted">
                    ${scoresMaturity
                      ? (m.byTheme[key]?.scored ?? 0) === 0
                        ? `none of ${total} scored yet`
                        : `${m.byTheme[key]?.atTarget ?? 0} of ${m.byTheme[key]?.scored ?? 0} scored at target · average ${(m.byTheme[key]?.average ?? 0).toFixed(1)}`
                      : html`<>
                          ${row["implemented"] ?? 0} of ${applicableIn(key)} in scope
                          ${total !== applicableIn(key) ? ` · ${total - applicableIn(key)} excluded` : ""}
                        </>`}
                  </div>
                </div>
              </div>`;
          })}
        </div>
      </div>

      <div class="card pad">
        <div class="section-title">
          <h2>Coverage profile</h2>
          ${crowded
            ? html`<span class="muted" style="font-size:12px">${themeKeys.length} ${plural(themeLabel).toLowerCase()}</span>`
            : null}
        </div>
        ${crowded
          ? themeGrid(
              themeKeys.map((k) => ({
                key: k,
                label: themes[k] ?? k,
                pct: readinessOf(k),
                total: Object.values(cs.byTheme[k] ?? {}).reduce((a, n) => a + n, 0),
                applicable: applicableIn(k),
              })),
            )
          : radar(themeKeys.map((k) => ({ key: k, label: themes[k] ?? k, pct: readinessOf(k) })))}
      </div>
    </div>

    <div class="grid two" style="margin-top:16px">
      <div class="card pad">
        <div class="section-title">
          <h2>${scoresMaturity ? "Maturity spread" : `${itemLabel} status`}</h2>
          <a class="st-open" href="#/controls">Open ${plural(itemLabel)} →</a>
        </div>
        <div class="donut-wrap">
          ${scoresMaturity
            ? donut(statusSlices, m.average.toFixed(1), "average")
            : donut(statusSlices, String(cs.readinessPct) + "%", "ready")}
          <div class="legend st-legend">
            ${statusSlices.map((slice, i) => html`
              <a href="#/controls" onClick=${(e: Event) => { e.preventDefault(); slice.onPick?.(); }}
                 title=${`Open the ${plural(itemLabel).toLowerCase()}: ${slice.label}`}>
                <span class="dot" style=${`background:${slice.color}`}></span>
                <span>${slice.label}</span>
                <b>${slice.value}</b>
                <span class="st-pct">${shareOf(i)}</span>
                <span class="st-go" aria-hidden="true">›</span>
              </a>`)}
          </div>
        </div>
        ${scoresMaturity ? null : html`<div class="st-next">
          <div class="st-next-h">${todo.length ? `Still to finish · ${todo.length}` : `Every ${itemLabel.toLowerCase()} in scope is implemented`}</div>
          ${todo.slice(0, 5).map((c) => html`<a class="st-item" key=${c.id} href=${`#/controls/${encodeURIComponent(c.id)}`}>
            <span class="st-ref">${c.ref}</span>
            <span class="st-t">${c.title}<small>${c.owner || "Nobody yet"}</small></span>
            <span class=${`pill ${STATUS_PILL[c.status]}`}>${STATUS_LABEL[c.status]}</span></a>`)}
          ${todo.length > 5 ? html`<a class="st-all" href="#/controls" onClick=${(e: Event) => { e.preventDefault(); openWithStatus("todo"); }}>Show all ${todo.length} →</a>` : null}
        </div>`}
      </div>

      <div class="card pad">
        <div class="section-title"><h2>Top risks</h2><a class="st-open" href="#/risks">Open Risks →</a></div>
        ${topRisks.length
          ? html`<table>
              <thead><tr><th>Risk</th><th>Owner</th><th style="text-align:right">Score</th></tr></thead>
              <tbody>
                ${topRisks.map((r) => html`
                  <tr>
                    <td>
                      <div>${r.title}</div>
                      <div class="muted" style="font-size:11.5px">${r.category || "Uncategorised"} · ${r.status}</div>
                    </td>
                    <td class="muted">${r.owner || "—"}</td>
                    <td style="text-align:right">
                      <span class="score" style=${`background:${RISK_BAND_COLOR[r.band]}`}>${r.inherent}</span>
                    </td>
                  </tr>`)}
              </tbody>
            </table>`
          : html`<p class="muted">No risks recorded yet.</p>`}
      </div>
    </div>
    ${ready && readyData
      ? html`<>
          <div class="sd-heading">Where you are heading</div>
          <div class="grid two sd-two">
            <${Forecast} d=${readyData} words=${pack.readiness} />
            <${Team} d=${readyData} />
          </div>
          <p class="muted" style="font-size:12.5px;margin:12px 0 0">Every number here is improved on Plan. <a href="#/getready">Go to Plan →</a></p>
        </>`
      : null}</>`;
}
