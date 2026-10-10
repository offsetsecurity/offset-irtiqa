import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { controlTests, type ControlTest } from "../persistence/apiClient.js";

/**
 * "We tested this on the 3rd, it passed, Priya did it."
 *
 * A status says what somebody believes today; a test says what happened on a
 * day. An auditor asking whether a control operates over time is asking for
 * this list, so each test is kept as its own row rather than as the latest
 * result overwriting the one before.
 *
 * Saved immediately, outside the dialog's Save, for the same reason evidence
 * is: a record of a test that disappears when somebody presses Cancel is worse
 * than no record at all.
 */

const RESULTS = ["Pass", "Partial", "Fail"] as const;
const PILL: Record<string, string> = { Pass: "green", Partial: "amber", Fail: "red" };

export function ControlTests({ controlId, canEdit, onChange }: {
  controlId: string;
  canEdit: boolean;
  onChange?: () => void;
}): VNode {
  const [tests, setTests] = useState<ControlTest[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [draft, setDraft] = useState({ testedOn: today, tester: "", result: "Pass", note: "" });

  async function load(): Promise<void> {
    setTests(await controlTests.list(controlId));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [controlId]);

  async function add(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await controlTests.add(controlId, draft);
      setDraft({ testedOn: today, tester: draft.tester, result: "Pass", note: "" });
      setAdding(false);
      await load();
      onChange?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await controlTests.remove(controlId, id);
      await load();
      onChange?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const last = tests?.[0];

  return html`<div class="card pad" style="box-shadow:none;border:1px solid var(--line)">
    <div class="toolbar" style="margin:0 0 10px">
      <b>Testing</b>
      ${last
        ? html`<span class="muted">Last tested ${last.tested_on} —
            <span class=${`pill ${PILL[last.result] ?? "slate"}`}>${last.result}</span></span>`
        : html`<span class="muted">Never tested</span>`}
      ${canEdit && !adding
        ? html`<button type="button" class="btn small" style="margin-left:auto"
                 onClick=${() => setAdding(true)}>Record a test</button>`
        : null}
    </div>

    ${error ? html`<div class="err" role="alert">${error}</div>` : null}

    ${adding
      ? html`<div class="confirm" style="margin:0 0 10px">
          <div class="grid two">
            <label class="fld">
              <span>Tested on</span>
              <input type="date" value=${draft.testedOn}
                onInput=${(e: Event) => setDraft({ ...draft, testedOn: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="fld">
              <span>Result</span>
              <select value=${draft.result}
                onChange=${(e: Event) => setDraft({ ...draft, result: (e.target as HTMLSelectElement).value })}>
                ${RESULTS.map((r) => html`<option value=${r}>${r}</option>`)}
              </select>
            </label>
            <label class="fld">
              <span>Tested by</span>
              <input value=${draft.tester} placeholder="Who did it"
                onInput=${(e: Event) => setDraft({ ...draft, tester: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="fld wide">
              <span>What you did and what you found</span>
              <textarea rows="2" value=${draft.note}
                onInput=${(e: Event) => setDraft({ ...draft, note: (e.target as HTMLTextAreaElement).value })}
              ></textarea>
            </label>
          </div>
          <div class="confirm-actions">
            <button type="button" class="btn small" disabled=${busy}
              onClick=${() => setAdding(false)}>Cancel</button>
            <button type="button" class="btn small primary" disabled=${busy || !draft.testedOn}
              onClick=${() => void add()}>${busy ? "Saving…" : "Save the test"}</button>
          </div>
        </div>`
      : null}

    ${tests === null
      ? html`<span class="muted">Loading…</span>`
      : tests.length === 0
      ? html`<p class="muted" style="margin:0">
          No tests recorded. A status is a claim; a test is evidence that the control worked on a
          day somebody checked.
        </p>`
      : html`<table>
          <tbody>
            ${tests.map((t) => html`
              <tr key=${t.id}>
                <td style="width:110px">${t.tested_on}</td>
                <td style="width:90px"><span class=${`pill ${PILL[t.result] ?? "slate"}`}>${t.result}</span></td>
                <td style="width:140px">${t.tester || html`<span class="muted">—</span>`}</td>
                <td>${t.note || html`<span class="muted">—</span>`}</td>
                <td style="width:80px;text-align:right">
                  ${canEdit
                    ? html`<button type="button" class="btn small ghost" disabled=${busy}
                             onClick=${() => void remove(t.id)}>Remove</button>`
                    : null}
                </td>
              </tr>`)}
          </tbody>
        </table>`}
  </div>`;
}
