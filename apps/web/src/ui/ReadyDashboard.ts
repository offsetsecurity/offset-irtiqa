import type { VNode } from "preact";
import { html } from "./html.js";
import type { ReadinessDashboard, ReadinessWords } from "../persistence/apiClient.js";

/**
 * The readiness parts of the Dashboard: the flight path to the external
 * audit, the auditor's-eye view, the readiness forecast and who is carrying
 * the work. Ported from Offset Attest. Things to look at, not to do: every
 * number links to the screen where it is improved.
 */

const DAY = 86_400_000;
const t = (d: string): number => Date.parse(`${d}T00:00:00Z`);
const longDay = (d: string): string =>
  new Date(t(d)).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const shortDay = (d: string): string =>
  new Date(t(d)).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const WORDS: ReadinessWords = {
  auditor: "auditor", auditorShort: "auditor", finding: "finding", findings: "findings",
  keyDate: "external audit", ledBy: "Led by",
};

export function FlightPath({ d, words = WORDS, label, showRing = true }: { d: ReadinessDashboard; words?: ReadinessWords; label: string; showRing?: boolean }): VNode {
  const k = d.keyDate;
  const today = new Date().toISOString().slice(0, 10);
  const R = 31, C = 2 * Math.PI * R;
  const ring = !showRing ? null : html`<div class="sd-ring">
    <svg width="76" height="76" viewBox="0 0 76 76" style="transform:rotate(-90deg)" aria-hidden="true">
      <circle cx="38" cy="38" r=${R} fill="none" stroke="#eef2f7" stroke-width="9" />
      <circle cx="38" cy="38" r=${R} fill="none" stroke="#15803d" stroke-width="9" stroke-linecap="round"
        stroke-dasharray=${C} stroke-dashoffset=${C - (C * d.readyPct) / 100} />
    </svg>
    <div><b>${d.readyPct}%</b><span>${label}</span></div>
  </div>`;

  if (!k) {
    return html`<div class="card pad sd-flight">
      <div class="sd-fp-top">
        <div>
          <div class="sr-lbl">Your flight path</div>
          <div class="sd-fp-title">No ${words.keyDate} booked yet</div>
          <p class="muted" style="margin:4px 0 10px">Add your ${words.keyDate} to Audits and reviews, as an external audit with its date, and this shows how many days you have and whether you will be ready in time.</p>
          <a class="btn small primary" href="#/reviews">Add the date in Audits and reviews</a>
        </div>
        ${ring}
      </div>
    </div>`;
  }

  // Positions along the track, as percentages: from a little before today to a
  // little after the audit.
  const first = Math.min(t(today), ...d.milestones.map((m) => t(m.date)));
  const from = first - 20 * DAY;
  const to = Math.max(t(k.date), t(today)) + 20 * DAY;
  const at = (d0: string): number => Math.max(0, Math.min(100, ((t(d0) - from) / (to - from)) * 100));
  const ready = d.projectedReady;
  const past = k.daysTo < 0;
  const pill = ready
    ? ready <= k.date
      ? html`<span class="sd-fp-pill"><i></i>At this pace you're ready on ${longDay(ready)}, before your ${words.keyDate}</span>`
      : html`<span class="sd-fp-pill amber"><i></i>At this pace you're ready on ${longDay(ready)}, after your ${words.keyDate}</span>`
    : d.readyPct >= 100
      ? html`<span class="sd-fp-pill"><i></i>Every control in scope is in place</span>`
      : html`<span class="sd-fp-pill wait"><i></i>Not enough history yet to forecast your ready date</span>`;

  return html`<div class="card pad sd-flight">
    <div class="sd-fp-top">
      <div style="min-width:0">
        <div class="sr-lbl">Your flight path · ${k.title}
          <a class="sd-edit" href="#/reviews" title="Change the date">Edit date</a></div>
        <div class="sd-fp-title">${past ? html`${capital(words.keyDate)} was ${longDay(k.date)}` : html`<em>${k.daysTo} day${k.daysTo === 1 ? "" : "s"}</em> to your ${words.keyDate}`}</div>
        ${pill}
      </div>
      ${ring}
    </div>
    <div class="sd-track" role="img" aria-label=${`Today to your ${words.keyDate} on ${longDay(k.date)}`}>
      <div class="sd-rail"></div>
      <div class="sd-fill" style=${`width:${at(today)}%`}></div>
      ${d.milestones.map((m) => html`<div class="sd-ms end above" style=${`left:${at(m.date)}%`} key=${`${m.kind}${m.date}`}><i></i><span>${m.kind} ${shortDay(m.date)}</span></div>`)}
      ${ready && t(ready) <= to ? html`<div class="sd-ms ready" style=${`left:${at(ready)}%`}><i></i><span>Ready ${shortDay(ready)}</span></div>` : null}
      <div class="sd-ms today" style=${`left:${at(today)}%`}><i></i><span>Today</span></div>
      <div class="sd-ms report" style=${`left:${at(k.date)}%`}><i></i><span>${capital(words.keyDate)} ${shortDay(k.date)}</span></div>
    </div>
    <div class="sd-stats">
      <div><span>${capital(words.keyDate)}</span><b>${longDay(k.date)}</b></div>
      <div><span>Days to go</span><b>${past ? "Held" : k.daysTo}</b></div>
      <div><span>Ready date</span><b class=${ready ? "" : "muted"}>${ready ? longDay(ready) : d.readyPct >= 100 ? "Ready now" : "Forecast soon"}</b></div>
      <div><span>${words.ledBy}</span><b style="color:#3730a3">${k.ledBy || "Not named yet"}</b></div>
    </div>
  </div>`;
}


export function Forecast({ d, words = WORDS }: { d: ReadinessDashboard; words?: ReadinessWords }): VNode {
  const pts = d.trend;
  const W = 520, H = 170, L = 40, T = 20, B = 140;
  const keyDay = d.keyDate?.date ?? null;
  const first = pts[0] ? t(pts[0].day) : Date.now();
  const last = Math.max(Date.now(), d.projectedReady ? t(d.projectedReady) : 0, keyDay ? t(keyDay) : 0) + 7 * DAY;
  const x = (day: string): number => L + ((t(day) - first) / Math.max(DAY, last - first)) * (W - L - 10);
  const y = (pct: number): number => B - (pct / 100) * (B - T);
  const line = pts.map((p) => `${x(p.day).toFixed(1)},${y(p.pct).toFixed(1)}`).join(" ");
  const now = pts[pts.length - 1];
  return html`<div class="card pad">
    <div class="sr-lbl">Readiness forecast</div>
    ${pts.length < 2
      ? html`<p class="muted">The forecast needs a few days of history. A snapshot is taken every night, so check back in a week.</p>`
      : html`<svg viewBox=${`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Readiness so far and forecast">
          ${[0, 50, 100].map((v) => html`<line x1=${L} y1=${y(v)} x2=${W - 10} y2=${y(v)} stroke="#eef2f7" />
            <text x=${L - 8} y=${y(v) + 4} font-size="10" fill="#5D687C" text-anchor="end">${v}%</text>`)}
          ${keyDay ? html`<line x1=${x(keyDay)} y1=${T - 8} x2=${x(keyDay)} y2=${B} stroke="#5b4bd6" stroke-dasharray="4 3" />
            <text x=${x(keyDay)} y=${H - 10} font-size="10.5" fill="#3730a3" text-anchor="middle">${capital(words.keyDate)}</text>` : null}
          <polyline points=${line} fill="none" stroke="#15803d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
          ${now && d.projectedReady
            ? html`<polyline points=${`${x(now.day)},${y(now.pct)} ${x(d.projectedReady)},${y(100)}`} fill="none" stroke="#15803d" stroke-width="2.5" stroke-dasharray="6 5" />
                <circle cx=${x(d.projectedReady)} cy=${y(100)} r="5" fill="#fff" stroke="#15803d" stroke-width="2" />`
            : null}
          ${now ? html`<circle cx=${x(now.day)} cy=${y(now.pct)} r="5" fill="#15803d" />` : null}
        </svg>`}
    <p style="font-size:12.5px;margin:4px 0 0" class="muted">
      ${d.weekChange > 0 ? html`<b style="color:var(--green)">+${d.weekChange} points</b> this week. ` : d.weekChange < 0 ? html`<b style="color:var(--red)">${d.weekChange} points</b> this week. ` : "No change this week. "}
      ${d.projectedReady ? `At this pace: ready ${longDay(d.projectedReady)}.` : "No pace to forecast from yet."}
    </p>
  </div>`;
}

export function Team({ d }: { d: ReadinessDashboard }): VNode {
  const max = Math.max(1, ...d.team.map((m) => m.total));
  return html`<div class="card pad">
    <div class="sr-lbl">Who's carrying it</div>
    ${d.team.map((m) => html`<div class="sd-team" key=${m.owner}>
      <span class="sd-av">${m.owner.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
      <span class="sd-name">${m.owner}</span>
      <span class="sd-bar"><i style=${`width:${(m.total / max) * 100}%`}></i><i class="done" style=${`width:${(m.implemented / max) * 100}%`}></i></span>
      <span class="muted">${m.implemented}/${m.total}</span>
    </div>`)}
    ${d.weakest
      ? html`<div class="sd-weak">
          <span class="sr-lbl" style="margin:0">Most behind</span>
          <b>${d.weakest.name}</b><span class="muted">${d.weakest.implemented} of ${d.weakest.total} in place</span>
          <a class="btn small" href="#/controls">Focus on it</a>
        </div>`
      : null}
  </div>`;
}
