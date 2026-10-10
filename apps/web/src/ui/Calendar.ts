import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { calendar, type Calendar as CalendarData, type CalendarItem } from "../persistence/apiClient.js";

/**
 * Everything with a date on it, in one list.
 *
 * The dates are already on eight screens, which is exactly the problem: nobody
 * opens eight screens on a Monday morning to find out what this week needs.
 * Nothing here is stored or editable — each row is a pointer back to the
 * register it came from, because that is where it should be changed.
 */

const KIND_SCREEN: Record<string, string> = {
  policies: "Policies", tasks: "Tasks", findings: "Findings", evidence: "Evidence",
  vendors: "Suppliers", objectives: "Objectives", training: "Training",
  reviews: "Audits and reviews", controls: "Controls", isms: "ISMS",
};

const day = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });

/** "3 days ago", "today", "in 12 days" — the part people actually read. */
const when = (due: string, today: string): string => {
  const days = Math.round(
    (new Date(`${due}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000,
  );
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days < 0 ? `${-days} days ago` : `in ${days} days`;
};

export function Calendar(): VNode {
  const [data, setData] = useState<CalendarData | null>(null);
  const [days, setDays] = useState(90);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    calendar
      .read(days)
      .then((d) => live && setData(d))
      .catch((err: Error) => live && setError(err.message));
    return () => { live = false; };
  }, [days]);

  if (error) return html`<div class="card pad err">${error}</div>`;
  if (!data) return html`<div class="card pad muted">Loading…</div>`;

  const { today } = data;
  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const groups: { id: string; name: string; note: string; items: CalendarItem[] }[] = [
    {
      id: "overdue",
      name: "Overdue",
      note: "Past its date. Either do it, or change the date and say why.",
      items: data.items.filter((i) => i.due < today),
    },
    {
      id: "soon",
      name: "Next 30 days",
      note: "Close enough to plan for.",
      items: data.items.filter((i) => i.due >= today && i.due <= in30),
    },
    {
      id: "later",
      name: "After that",
      note: `Everything else up to ${day(data.horizon)}.`,
      items: data.items.filter((i) => i.due > in30),
    },
  ];

  const row = (item: CalendarItem, overdue: boolean): VNode => html`
    <tr key=${`${item.screen}-${item.id}`}>
      <td style="width:150px">
        <div style=${overdue ? "color:var(--red);font-weight:700" : ""}>${day(item.due)}</div>
        <div class="muted" style="font-size:11.5px">${when(item.due, today)}</div>
      </td>
      <td style="width:150px"><span class="pill slate">${item.kind}</span></td>
      <td>
        <div>${item.title}</div>
        <div class="muted" style="font-size:11.5px">${item.detail}</div>
      </td>
      <td style="width:150px">${item.owner || html`<span class="muted">—</span>`}</td>
      <td style="width:130px;text-align:right">
        <a class="btn small" href=${`#/${item.screen}`}>${KIND_SCREEN[item.screen] ?? "Open"}</a>
      </td>
    </tr>`;

  return html`<>
    <div class="card pad">
      <div class="toolbar">
        <div class="grid cards" style="grid-template-columns:repeat(3,1fr);gap:10px;flex:1">
          <div class="card pad stat" style="border-left:3px solid #dc2626;box-shadow:none">
            <div class="lbl">Overdue</div>
            <div class="val">${data.counts.overdue}</div>
            <div class="delta">past their date</div>
          </div>
          <div class="card pad stat" style="border-left:3px solid #d97706;box-shadow:none">
            <div class="lbl">Next 30 days</div>
            <div class="val">${data.counts.soon}</div>
            <div class="delta">coming up</div>
          </div>
          <div class="card pad stat" style="border-left:3px solid #1e3a8a;box-shadow:none">
            <div class="lbl">After that</div>
            <div class="val">${data.counts.later}</div>
            <div class="delta">to ${day(data.horizon)}</div>
          </div>
        </div>
      </div>
      <div class="toolbar" style="margin-top:12px">
        <span class="muted">Looking ahead</span>
        <select value=${String(days)}
                onChange=${(e: Event) => setDays(Number((e.target as HTMLSelectElement).value))}>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="180">6 months</option>
          <option value="365">a year</option>
        </select>
        <div class="toolbar-note muted">
          Policy reviews, tasks, findings, evidence, suppliers, objectives, training, audits and
          control due dates. Change a date on its own screen.
        </div>
      </div>
    </div>

    ${groups.map((group) => html`
      <div class="card pad" key=${group.id}>
        <h2 class="section-h">${group.name} <span class="muted">(${group.items.length})</span></h2>
        <p class="muted section-note">${group.note}</p>
        ${group.items.length === 0
          ? html`<p class="muted">Nothing here.</p>`
          : html`<table><tbody>
              ${group.items.map((item) => row(item, group.id === "overdue"))}
            </tbody></table>`}
      </div>`)}
  </>`;
}
