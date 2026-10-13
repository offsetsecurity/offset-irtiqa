import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import {
  escalation as escalationApi,
  type ChainLevel, type EscalationState, type ReminderLogRow,
} from "../persistence/apiClient.js";

/**
 * Who is told when something is ignored, and what has been sent.
 *
 * Until a date passes, only the person who owns the thing hears about it. After
 * that, up to four people are told in turn - the administrator, their manager,
 * that person's manager, top management - each message copying in everybody
 * above, so nobody is left wondering whether the manager knows.
 *
 * Every email is one thing, never a list. And every one is written down and
 * shown at the foot of the screen, which is the answer when an auditor asks
 * whether people were chased.
 */

const STAGE_WORDS = (stage: string, level: number): string => {
  if (stage.startsWith("level-")) return `Escalation, level ${level}`;
  if (stage === "on") return "Due today";
  if (stage.startsWith("after-")) {
    const n = Number(stage.slice(6));
    return `Overdue ${n} day${n === 1 ? "" : "s"}`;
  }
  if (stage.startsWith("before-")) return `${stage.slice(7)}-day warning`;
  return stage;
};

export function Escalation({ canEdit }: { canEdit: boolean }): VNode {
  const [state, setState] = useState<EscalationState | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [chain, setChain] = useState<ChainLevel[]>([]);
  const [log, setLog] = useState<ReminderLogRow[]>([]);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = async (): Promise<void> => {
    const [s, l] = await Promise.all([escalationApi.get(), escalationApi.log(100)]);
    setState(s);
    setEnabled(s.escalation.enabled);
    setChain(s.escalation.chain);
    setLog(l);
  };

  useEffect(() => {
    load().catch((err: Error) => setNote({ kind: "err", text: err.message }));
  }, []);

  const edit = (i: number, patch: Partial<ChainLevel>): void =>
    setChain((cur) => cur.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  async function save(): Promise<void> {
    setBusy("save");
    setNote(null);
    try {
      const saved = await escalationApi.save({
        enabled,
        chain: chain.map((l) => ({ name: l.name.trim(), email: l.email.trim(), days: Number(l.days) })),
      });
      setChain(saved.chain);
      setNote({ kind: "ok", text: "Saved." });
    } catch (err) {
      setNote({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy("");
    }
  }

  async function runNow(): Promise<void> {
    if (!confirm("Send every reminder that is due today? Nothing is sent twice.")) return;
    setBusy("run");
    setNote(null);
    try {
      const r = await escalationApi.run();
      if (r.blocked) setNote({ kind: "err", text: `Nothing was sent. ${r.blocked}` });
      else {
        setNote({
          kind: r.failed ? "err" : "ok",
          text: `Sent ${r.owner} to the people who own them and ${r.chain} up the chain` +
            (r.failed ? `, ${r.failed} failed (see below).` : "."),
        });
      }
      await load();
    } catch (err) {
      setNote({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy("");
    }
  }

  if (!state) return html`<div class="card pad muted">${note?.text ?? "Loading…"}</div>`;

  return html`<div class="isms">
    ${note ? html`<div class=${note.kind === "ok" ? "ok-note" : "err"}>${note.text}</div>` : null}

    <section class="card pad">
      <div class="section-title"><h2>Automatic reminders</h2></div>
      <p class="muted section-note">
        Everything with an owner's email address and a date is chased, so nobody has to remember.${" "}<b>Every item is its own email</b>: three overdue items mean three emails, never one list.
      </p>
      <ul class="muted section-note" style="padding-left:1.2rem;line-height:1.7">
        <li>To the owner: <b>${state.schedule.before.join(", ")} days before</b> it is due,${" "}<b>on the day</b>, then <b>every day</b> after until it is done.</li>
        <li>Nothing is sent for anything without both a date and an address.</li>
        <li>The moment it is done, or the address is cleared, the emails stop.</li>
      </ul>
      ${state.emailReady
        ? null
        : html`<div class="err">Email is not working yet, so nothing can be sent: ${state.emailProblem}${" "}Set it up in <a href="#/settings">Settings</a>.</div>`}
      <label class="check-row" style="display:flex;align-items:center;gap:8px;margin:6px 0 14px">
        <input type="checkbox" disabled=${!canEdit} checked=${enabled}
          onChange=${(e: Event) => setEnabled((e.target as HTMLInputElement).checked)} />
        <b>Send reminders automatically</b>
        <span class="muted">once a day, early in the morning</span>
      </label>
      ${canEdit
        ? html`<div class="row-actions form-actions">
            <button type="button" class="btn primary" disabled=${busy !== ""} onClick=${() => void save()}>
              ${busy === "save" ? "Saving…" : "Save"}
            </button>
            <button type="button" class="btn" disabled=${busy !== "" || !state.emailReady} onClick=${() => void runNow()}>
              ${busy === "run" ? "Sending…" : "Send what is due now"}
            </button>
          </div>`
        : null}
    </section>

    <section class="card pad">
      <div class="section-title"><h2>Who is told when something is overdue</h2></div>
      <p class="muted section-note">
        When something goes overdue, these people are told one after another. Each email goes to one
        person and <b>copies in everyone above</b>, and says who else has been told. A level is told
        when it is reached, then <b>every ${state.schedule.repeatDays} days</b> until it is done. Leave a
        level's email empty to skip it.
      </p>
      <div class="isms-table"><table>
        <thead><tr>
          <th style="width:80px">Level</th><th style="width:24%">Who</th><th>Name</th><th>Email</th>
          <th style="width:150px">Days overdue</th>
        </tr></thead>
        <tbody>${chain.map((l, i) => html`<tr key=${i}>
          <td><span class="pill slate">${i + 1}</span></td>
          <td><b>${l.role}</b></td>
          <td><input type="text" disabled=${!canEdit} value=${l.name} placeholder="Name"
                onInput=${(e: Event) => edit(i, { name: (e.target as HTMLInputElement).value })} /></td>
          <td><input type="email" disabled=${!canEdit} value=${l.email} placeholder="name@company.com"
                onInput=${(e: Event) => edit(i, { email: (e.target as HTMLInputElement).value })} /></td>
          <td><input type="number" min="1" max="365" disabled=${!canEdit} value=${l.days}
                onInput=${(e: Event) => edit(i, { days: Number((e.target as HTMLInputElement).value) })} /></td>
        </tr>`)}</tbody>
      </table></div>
      <p class="muted section-note" style="margin-top:10px">
        "Days overdue" counts from the day after the date: 1 is the first day it is overdue.
      </p>
      ${canEdit
        ? html`<div class="row-actions form-actions">
            <button type="button" class="btn primary" disabled=${busy !== ""} onClick=${() => void save()}>
              ${busy === "save" ? "Saving…" : "Save"}
            </button>
          </div>`
        : null}
    </section>

    <section class="card pad">
      <div class="section-title">
        <h2>What was sent</h2>
        <span class="muted">The latest 100. Nothing here can be changed.</span>
      </div>
      <div class="isms-table"><table>
        <thead><tr>
          <th style="width:110px">Date</th><th>What</th><th>Why</th><th>Sent to</th><th style="width:90px">Result</th>
        </tr></thead>
        <tbody>${log.length
          ? log.map((r) => html`<tr key=${r.id}>
              <td>${r.sent_on}</td>
              <td><b>${r.item_ref}</b> ${r.item_title}
                  ${r.owner ? html`<div class="muted" style="font-size:12px">${r.owner}</div>` : null}</td>
              <td>${STAGE_WORDS(r.stage, r.level)}</td>
              <td>${r.to_email}
                  ${r.cc ? html`<div class="muted" style="font-size:12px">copied: ${r.cc}</div>` : null}</td>
              <td>${r.ok
                ? html`<span class="pill green">Sent</span>`
                : html`<span class="pill red" title=${r.error ?? ""}>Failed</span>`}</td>
            </tr>`)
          : html`<tr><td colspan="5" class="muted">Nothing has been sent yet.</td></tr>`}</tbody>
      </table></div>
    </section>
  </div>`;
}
