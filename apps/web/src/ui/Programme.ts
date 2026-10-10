import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { Field } from "./Modal.js";
import { programme, type Programme as ProgrammeRow } from "../persistence/apiClient.js";

/**
 * What this programme covers, and how it was assessed.
 *
 * Both columns have existed on the programme row since the beginning and
 * nothing ever wrote to them, which made the readiness plan's first real
 * instruction — "write down your scope" — send people to a screen with no
 * scope on it.
 *
 * It is the first thing an assessor reads and the thing every later argument
 * gets settled against, so it is two plain text boxes and no ceremony. There
 * is no format to get wrong.
 */

export function Programme({ canEdit }: { canEdit: boolean }): VNode {
  const [row, setRow] = useState<ProgrammeRow | null>(null);
  const [scope, setScope] = useState("");
  const [methodology, setMethodology] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    programme
      .get()
      .then((p) => {
        if (!live) return;
        setRow(p);
        setScope(p.scope ?? "");
        setMethodology(p.methodology ?? "");
      })
      .catch((err: Error) => live && setNote({ kind: "err", text: err.message }));
    return () => { live = false; };
  }, []);

  const dirty =
    row !== null && (scope !== (row.scope ?? "") || methodology !== (row.methodology ?? ""));

  async function save(e: Event): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const saved = await programme.update({ scope, methodology });
      setRow(saved);
      setNote({ kind: "ok", text: "Saved." });
    } catch (err) {
      setNote({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!row) {
    return html`<form class="card pad">
      <h2 class="section-h">Scope</h2>
      <p class="muted section-note">${note?.text ?? "Loading…"}</p>
    </form>`;
  }

  return html`
    <form class="card pad" onSubmit=${save}>
      <h2 class="section-h">Scope</h2>
      <p class="muted section-note">
        What this programme covers. The first thing an assessor reads, and what every
        later question gets settled against. A paragraph is enough.
      </p>

      ${note
        ? html`<div class=${note.kind === "ok" ? "ok-note" : "err"}>${note.text}</div>`
        : null}

      <div class="form-grid">
        <${Field} label="What is in scope" wide=${true}
                  hint="Which company, which services, which locations, which systems. Say plainly what is not covered.">
          <textarea rows="5" disabled=${!canEdit} value=${scope}
            placeholder="This programme covers ..."
            onInput=${(e: Event) => setScope((e.target as HTMLTextAreaElement).value)}
          ></textarea>
        <//>

        <${Field} label="How you assessed it" wide=${true}
                  hint="Optional. Who did the assessment, when, and what they looked at. Worth a line so the next person knows.">
          <textarea rows="4" disabled=${!canEdit} value=${methodology}
            onInput=${(e: Event) => setMethodology((e.target as HTMLTextAreaElement).value)}
          ></textarea>
        <//>
      </div>

      ${canEdit
        ? html`<div class="row-actions form-actions">
            <button class="btn primary" type="submit" disabled=${busy || !dirty}>
              ${busy ? "Saving…" : "Save"}
            </button>
          </div>`
        : html`<p class="muted section-note">Your role can read this but not change it.</p>`}
    </form>`;
}
