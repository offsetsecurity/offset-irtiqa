import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { branding, type BrandLogo } from "../persistence/apiClient.js";

/**
 * The logo that appears on exported reports.
 *
 * It sits on the Reports screen rather than in a settings area, because this
 * is where someone wonders whose logo is on the PDF they are about to hand to
 * an auditor.
 *
 * The server validates the file by rendering it into a throwaway PDF before
 * saving, so a file that cannot be drawn is refused here rather than breaking
 * every export afterwards.
 */

const MAX_BYTES = 512 * 1024;
const ACCEPT = "image/png,image/jpeg,image/svg+xml";

/** Reads a file as either raw SVG text or a data URI, whichever the PDF wants. */
function readFile(file: File): Promise<{ kind: "image" | "svg"; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That file could not be read."));
    if (file.type === "image/svg+xml") {
      reader.onload = () => resolve({ kind: "svg", data: String(reader.result) });
      reader.readAsText(file);
    } else {
      reader.onload = () => resolve({ kind: "image", data: String(reader.result) });
      reader.readAsDataURL(file);
    }
  });
}

export function Branding({ canEdit }: { canEdit: boolean }): VNode {
  const [logo, setLogo] = useState<BrandLogo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    branding
      .get()
      .then((l) => live && setLogo(l))
      .catch(() => { /* reports still work without a logo */ })
      .finally(() => live && setLoaded(true));
    return () => { live = false; };
  }, []);

  async function choose(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // so picking the same file twice still fires
    if (!file) return;

    setError("");
    if (!ACCEPT.split(",").includes(file.type)) {
      setError("Use a PNG, JPEG or SVG file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That file is ${Math.round(file.size / 1024)} KB. The limit is 512 KB.`);
      return;
    }

    setBusy(true);
    try {
      const { kind, data } = await readFile(file);
      setLogo(await branding.set({ kind, data, filename: file.name }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      setLogo(await branding.set(null));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return html`<div class="card pad muted">Loading…</div>`;

  const preview = logo
    ? logo.kind === "svg"
      ? `data:image/svg+xml;utf8,${encodeURIComponent(logo.data)}`
      : logo.data
    : null;

  return html`
    <div class="card pad branding">
      <div class="section-title">
        <h2>Logo on reports</h2>
        <span class="muted" style="font-size:12px">PNG, JPEG or SVG · up to 512 KB</span>
      </div>

      <div class="branding-row">
        <div class="logo-well">
          ${preview
            ? html`<img src=${preview} alt=${logo!.filename || "Your logo"} />`
            : html`<span class="muted">No logo set</span>`}
        </div>

        <div class="branding-copy">
          <p class="muted">
            ${logo
              ? `Your logo appears at the top of every report. ${logo.filename || "Uploaded file"} · ${Math.max(1, Math.round(logo.bytes / 1024))} KB.`
              : "Add your own logo and it appears at the top of every report, where an auditor expects to see the organisation being audited. Until then, reports carry the Offset Security mark."}
          </p>
          <p class="muted" style="font-size:11.5px">
            Any shape works — it is scaled to fit a fixed box, so a tall logo and a
            wide one both sit in the same space without being stretched.
          </p>

          ${error ? html`<div class="err" role="alert">${error}</div>` : null}

          ${canEdit
            ? html`
                <div class="branding-actions">
                  <label class=${`btn${busy ? " disabled" : ""}`}>
                    ${busy ? "Checking…" : logo ? "Replace logo" : "Upload logo"}
                    <input type="file" accept=${ACCEPT} hidden disabled=${busy}
                           onChange=${(e: Event) => void choose(e)} />
                  </label>
                  ${logo
                    ? html`<button class="btn danger" disabled=${busy} onClick=${() => void remove()}>
                        Remove
                      </button>`
                    : null}
                </div>`
            : html`<p class="muted" style="font-size:11.5px">
                Only an administrator can change this.
              </p>`}
        </div>
      </div>
    </div>`;
}
