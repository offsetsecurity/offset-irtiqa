import { useEffect, useRef, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { backups, type BackupInfo } from "../persistence/apiClient.js";

/**
 * Backups: take one, keep them, download them, and restore one.
 *
 * Restoring replaces everything, so it is the one action on this screen that
 * asks twice - once to choose, once to type the word - and says plainly what
 * will happen, including that a backup of the present is taken first.
 */

const KIND: Record<BackupInfo["kind"], string> = {
  nightly: "Nightly",
  manual: "Taken by hand",
  "pre-restore": "Before a restore",
  "pre-update": "Before an update",
  uploaded: "Uploaded",
};

const size = (bytes: number): string =>
  bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    : bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function Backups({ onRestored }: { onRestored: () => void }): VNode {
  const [rows, setRows] = useState<BackupInfo[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState<BackupInfo | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function load(): Promise<void> {
    setRows(await backups.list());
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function run(label: string, work: () => Promise<void>): Promise<void> {
    setBusy(label);
    setError("");
    setNote("");
    try {
      await work();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  const take = (): Promise<void> =>
    run("take", async () => {
      const b = await backups.take();
      setNote(
        `Backup taken: the database${b.evidenceFiles ? ` and ${b.evidenceFiles} evidence document${b.evidenceFiles === 1 ? "" : "s"}` : ""}.`,
      );
    });

  const upload = (file: File): Promise<void> =>
    run("upload", async () => {
      await backups.upload(file);
      setNote("Uploaded and checked. It is in the list below, ready to restore.");
    });

  async function restore(b: BackupInfo): Promise<void> {
    setBusy("restore");
    setError("");
    try {
      await backups.restore(b.name);
      setRestoring(null);
      setNote("Restored. Everyone has been signed out. Sign in again with the accounts as they were in that backup.");
      // Give the message a moment on screen before the sign-in page replaces it.
      setTimeout(onRestored, 3500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (!rows) {
    return html`<div class="card pad">${error ? html`<div class="err">${error}</div>` : html`<span class="muted">Loading…</span>`}</div>`;
  }

  return html`<>
    <div class="card pad">
      <h2 class="section-h">Take a backup</h2>
      <p class="muted section-note">
        A backup holds the whole database and every evidence document, in one file. One is
        taken automatically every night. Take one yourself before a big change, and download
        one now and then to keep somewhere other than this server.
      </p>
      ${note ? html`<div class="ok-note" role="status">${note}</div>` : null}
      ${error ? html`<div class="err" role="alert">${error}</div>` : null}
      <div class="confirm-actions" style="justify-content:flex-start">
        <button type="button" class="btn primary" disabled=${Boolean(busy)} onClick=${() => void take()}>
          ${busy === "take" ? "Taking a backup…" : "Take a backup now"}
        </button>
        <button type="button" class="btn" disabled=${Boolean(busy)} onClick=${() => fileInput.current?.click()}>
          ${busy === "upload" ? "Uploading and checking…" : "Upload a backup"}
        </button>
        <input ref=${fileInput} type="file" accept=".db" style="display:none"
          onChange=${(e: Event) => {
            const input = e.target as HTMLInputElement;
            const file = input.files?.[0];
            input.value = "";
            if (file) void upload(file);
          }} />
      </div>
    </div>

    ${restoring
      ? html`<div class="card pad">
          <div class="confirm" style="margin-top:0">
            <div><b>Restore the backup from ${when(restoring.createdAt)}?</b></div>
            <ul class="muted" style="margin:8px 0 0;padding-left:18px">
              <li>Everything in the product is replaced by what was in this backup.
                  Anything added or changed since then is gone.</li>
              ${restoring.includesEvidence
                ? html`<li>Evidence documents are put back as they were.</li>`
                : html`<li><b>This backup has no evidence documents in it.</b> The documents
                    here now stay, but records may point at files that are missing.</li>`}
              <li>A backup of everything as it is now is taken first, so this can be undone by
                  restoring that.</li>
              <li>Everyone is signed out, and signs in with the accounts as they were then.</li>
            </ul>
            <label class="fld" style="margin:12px 0 0">
              <span>Type RESTORE to confirm</span>
              <input value=${typed} autocomplete="off"
                onInput=${(e: Event) => setTyped((e.target as HTMLInputElement).value)} />
            </label>
            <div class="confirm-actions">
              <button type="button" class="btn small" disabled=${busy === "restore"}
                onClick=${() => { setRestoring(null); setTyped(""); }}>Cancel</button>
              <button type="button" class="btn small danger"
                disabled=${typed !== "RESTORE" || busy === "restore"}
                onClick=${() => void restore(restoring)}>
                ${busy === "restore" ? "Restoring…" : "Restore this backup"}
              </button>
            </div>
          </div>
        </div>`
      : null}

    <div class="card pad">
      <h2 class="section-h">Backups on this server</h2>
      ${rows.length === 0
        ? html`<p class="muted">None yet. The first nightly backup is taken within a day of installing.</p>`
        : html`<table>
            <thead>
              <tr>
                <th>Taken</th>
                <th style="width:150px">Type</th>
                <th style="width:90px">Size</th>
                <th>Contents</th>
                <th style="width:260px"></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((b) => html`
                <tr key=${b.name}>
                  <td>
                    <div>${when(b.createdAt)}</div>
                    <div class="muted" style="font-size:11.5px">${b.name}</div>
                  </td>
                  <td>${KIND[b.kind]}</td>
                  <td>${size(b.size)}</td>
                  <td>
                    ${b.includesEvidence
                      ? `Database and ${b.evidenceFiles} evidence document${b.evidenceFiles === 1 ? "" : "s"}`
                      : html`<span class="muted">Database only</span>`}
                  </td>
                  <td style="text-align:right;white-space:nowrap">
                    ${deleting?.name === b.name
                      ? html`<span class="muted" style="margin-right:6px">Delete it?</span>
                          <button type="button" class="btn small" onClick=${() => setDeleting(null)}>No</button>
                          <button type="button" class="btn small danger" disabled=${Boolean(busy)}
                            onClick=${() => void run("delete", async () => { await backups.remove(b.name); setDeleting(null); })}>
                            Yes, delete
                          </button>`
                      : html`<a class="btn small" href=${backups.downloadUrl(b.name)} download=${b.name}>Download</a>
                          <button type="button" class="btn small" disabled=${Boolean(busy)}
                            onClick=${() => { setTyped(""); setRestoring(b); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                            Restore
                          </button>
                          <button type="button" class="btn small ghost" disabled=${Boolean(busy)}
                            onClick=${() => setDeleting(b)}>Delete</button>`}
                  </td>
                </tr>`)}
            </tbody>
          </table>`}
    </div>
  </>`;
}
