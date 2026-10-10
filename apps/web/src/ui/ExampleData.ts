import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { demo } from "../persistence/apiClient.js";

/**
 * A small filled-in organisation, and a way to remove it again.
 *
 * Empty registers are impossible to judge. Somebody deciding whether to spend a
 * week filling this in wants to see a week's work first, and a demonstration
 * should not open with twenty minutes of typing.
 *
 * Every example row is marked as one, and removing them deletes exactly those
 * rows. That is what makes the button safe to offer on a live install: real
 * work cannot be caught by it.
 */
export function ExampleData(): VNode {
  const [rows, setRows] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function load(): Promise<void> {
    const state = await demo.state();
    setRows(state.rows);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function run(what: "load" | "remove"): Promise<void> {
    setBusy(what);
    setError("");
    setNote("");
    try {
      if (what === "load") {
        const { rows: added } = await demo.load();
        setNote(`${added} example rows added. Look around, then remove them when you are ready to start for real.`);
      } else {
        const { removed } = await demo.remove();
        setNote(`${removed} example rows removed. Anything you added yourself is untouched.`);
      }
      setConfirming(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  return html`<div class="card pad">
    <h2 class="section-h">Example data</h2>
    <p class="muted section-note">
      A small software company with a customer portal, a payroll bureau and an office: assets,
      risks, policies, suppliers, training, objectives, interested parties, an internal audit, a
      management review, findings with a corrective action, tasks, incidents and evidence, all
      joined up to the controls they belong to.
    </p>

    ${note ? html`<div class="ok-note" role="status">${note}</div>` : null}
    ${error ? html`<div class="err" role="alert">${error}</div>` : null}

    ${rows === null
      ? html`<span class="muted">Loading…</span>`
      : rows > 0
      ? html`<>
          <p><b>${rows} example rows are loaded.</b> They are marked as examples, so removing them
            leaves everything you have added yourself exactly as it is.</p>
          ${confirming
            ? html`<div class="confirm">
                <div><b>Remove the ${rows} example rows?</b></div>
                <div class="muted" style="margin-top:4px">
                  Only rows loaded from here are deleted. Anything you wrote, edited or attached
                  stays. This cannot be undone, but the examples can be loaded again.
                </div>
                <div class="confirm-actions">
                  <button type="button" class="btn small" disabled=${Boolean(busy)}
                    onClick=${() => setConfirming(false)}>Keep them</button>
                  <button type="button" class="btn small danger" disabled=${Boolean(busy)}
                    onClick=${() => void run("remove")}>
                    ${busy === "remove" ? "Removing…" : "Remove the examples"}
                  </button>
                </div>
              </div>`
            : html`<button type="button" class="btn" disabled=${Boolean(busy)}
                     onClick=${() => setConfirming(true)}>Remove the example data</button>`}
        </>`
      : html`<>
          <p class="muted">Nothing loaded. Your registers hold only what you have put in them.</p>
          <button type="button" class="btn primary" disabled=${Boolean(busy)}
            onClick=${() => void run("load")}>
            ${busy === "load" ? "Loading…" : "Load example data"}
          </button>
        </>`}
  </div>`;
}
