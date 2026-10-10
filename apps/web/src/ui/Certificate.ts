import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import {
  certificate, type CertificateInfo, type CertificateStatus,
} from "../persistence/apiClient.js";

/**
 * Settings → HTTPS certificate.
 *
 * The browser says "Not secure" until the server has a certificate the
 * browser trusts. Most companies already run their own certificate
 * authority; their IT team issues one for this server's name, and this is
 * where it goes. No settings file, no file paths, no command line.
 *
 * Takes what IT teams actually hand over: a .pfx with a password from
 * Windows, or PEM files (a certificate and a key, or Let's Encrypt's
 * fullchain.pem and privkey.pem). The server checks it before saving and
 * shows anything worth knowing - the wrong name, self-signed - before it
 * replaces a certificate that works.
 */

const ACCEPT = ".pfx,.p12,.pem,.crt,.cer,.key";
const MAX_BYTES = 64 * 1024;

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function Facts({ info }: { info: CertificateInfo }): VNode {
  const expiry =
    info.daysLeft < 0
      ? html`<span class="pill red">Expired</span>`
      : info.daysLeft <= 30
        ? html`<span class="pill amber">${info.daysLeft} days left</span>`
        : html`<span class="muted">${info.daysLeft} days left</span>`;
  return html`
    <dl class="cert-facts">
      <dt>Issued to</dt>
      <dd>${info.names.length ? info.names.join(", ") : info.subject}</dd>
      <dt>Issued by</dt>
      <dd>${info.selfSigned ? "Itself (self-signed)" : info.issuer}</dd>
      <dt>Valid until</dt>
      <dd>${day(info.validTo)} ${expiry}</dd>
      <dt>Fingerprint</dt>
      <dd class="mono">${info.fingerprint}</dd>
    </dl>`;
}

function Warnings({ items }: { items: string[] }): VNode | null {
  if (!items.length) return null;
  return html`<ul class="cert-warnings">${items.map((w) => html`<li>${w}</li>`)}</ul>`;
}

export function Certificate(): VNode {
  const [status, setStatus] = useState<CertificateStatus | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  /** A certificate the server checked and has questions about, not yet saved. */
  const [pending, setPending] = useState<{ certificate: CertificateInfo; warnings: string[] } | null>(null);

  useEffect(() => {
    certificate.get().then(setStatus).catch((err: Error) => setError(err.message));
  }, []);

  function choose(event: Event): void {
    const input = event.target as HTMLInputElement;
    const chosen = [...(input.files ?? [])];
    input.value = "";
    setError("");
    setNote("");
    setPending(null);
    const big = chosen.find((f) => f.size > MAX_BYTES);
    if (big) {
      setError(`${big.name} is too big to be a certificate. Choose the certificate and key files.`);
      return;
    }
    setFiles(chosen);
  }

  async function upload(confirm: boolean): Promise<void> {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const payload = await Promise.all(files.map(async (f) => ({ name: f.name, data: await readBase64(f) })));
      const result = await certificate.upload(payload, password, confirm);
      if (result.needsConfirmation) {
        setPending({ certificate: result.certificate, warnings: result.warnings });
        return;
      }
      setPending(null);
      setFiles([]);
      setPassword("");
      setStatus(result.status);
      setNote(
        result.appliedNow
          ? "Saved and in use. Reload the page to see the new certificate in your browser."
          : "Saved. It takes effect when the product is restarted - see below.",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm("Remove the uploaded certificate?")) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const result = await certificate.remove();
      setStatus(result.status);
      setNote("Removed.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return html`<div class="card pad muted">${error || "Loading…"}</div>`;
  }

  const https = status.serving === "https";
  const pfx = files.some((f) => /\.(pfx|p12)$/i.test(f.name));

  return html`
    <div class="card pad">
      <h2 class="section-h">
        HTTPS certificate${" "}
        ${https ? html`<span class="pill green">HTTPS on</span>` : html`<span class="pill slate">HTTPS off</span>`}
      </h2>
      <p class="muted section-note">
        Browsers say "Not secure" until this server has a certificate they trust. Ask your IT
        team for one issued by your company's own certificate authority, for the name people
        type to reach this server. It costs nothing, and every company computer already trusts it.
      </p>

      ${status.problem ? html`<div class="err" role="alert">${status.problem}</div>` : null}

      ${status.certificate
        ? html`
            <${Facts} info=${status.certificate} />
            <p class="muted section-note">
              ${status.source === "uploaded"
                ? `Uploaded here${status.upload ? ` on ${day(status.upload.uploadedAt)} (${status.upload.filenames.join(", ")})` : ""}.`
                : "Named in the settings file (TLS_CERT_FILE and TLS_KEY_FILE). A certificate uploaded here replaces it."}
            </p>
            <${Warnings} items=${status.warnings} />`
        : status.problem
          ? null
          : html`<p class="muted section-note">No certificate yet. The product is using plain HTTP.</p>`}

      ${status.restartNeeded
        ? html`<div class="cert-restart">
            <strong>Restart needed.</strong>
            ${status.source === "none"
              ? " It is still serving the old certificate until it restarts, and then goes back to plain HTTP."
              : " The certificate is saved, and the product switches to HTTPS when it restarts."}
            <div class="muted">${status.restartHow}</div>
          </div>`
        : null}

      ${status.localOnly
        ? html`<p class="muted section-note">
            Right now only this computer can open the product. To let colleagues reach it, set
            ${" "}<code>HOST=0.0.0.0</code> and <code>PUBLIC_URL=https://</code><em>the server's name</em><code>:port</code>
            ${" "}in the settings file, and restart. The administrator guide shows where that file is.
          </p>`
        : null}

      ${https && status.publicUrl.startsWith("http://")
        ? html`<p class="muted section-note">
            PUBLIC_URL in the settings file still starts with http://, so links in emails do too.
            They still work, because http:// is redirected, but change it to https:// when you next restart.
          </p>`
        : null}

      ${note ? html`<div class="ok-note">${note}</div>` : null}
      ${error && status ? html`<div class="err" role="alert">${error}</div>` : null}

      ${pending
        ? html`
            <div class="cert-pending">
              <strong>Check this before it is used.</strong>
              <${Facts} info=${pending.certificate} />
              <${Warnings} items=${pending.warnings} />
              <div class="branding-actions">
                <button class="btn" disabled=${busy} onClick=${() => void upload(true)}>
                  ${busy ? "Saving…" : "Use it anyway"}
                </button>
                <button class="btn ghost" disabled=${busy} onClick=${() => setPending(null)}>Cancel</button>
              </div>
            </div>`
        : html`
            <div class="cert-upload">
              <label class=${`btn${busy ? " disabled" : ""}`}>
                Choose files
                <input type="file" multiple accept=${ACCEPT} hidden disabled=${busy}
                       onChange=${choose} />
              </label>
              <span class="muted">
                ${files.length
                  ? files.map((f) => f.name).join(", ")
                  : "A .pfx file, or the certificate and its key (.pem, .crt, .key)"}
              </span>
            </div>
            ${files.length
              ? html`
                  <label class="fld cert-password">
                    <span>Password${pfx ? "" : " (only if the key has one)"}</span>
                    <input type="password" autocomplete="off" value=${password}
                           onInput=${(e: Event) => setPassword((e.target as HTMLInputElement).value)} />
                  </label>
                  <div class="branding-actions">
                    <button class="btn" disabled=${busy} onClick=${() => void upload(false)}>
                      ${busy ? "Checking…" : status.source === "none" ? "Upload certificate" : "Replace certificate"}
                    </button>
                  </div>`
              : null}
          `}

      ${status.source === "uploaded" && !pending
        ? html`<div class="cert-remove">
            ${status.removeBlocked
              ? html`<span class="muted">${status.removeBlocked}</span>`
              : html`<button class="btn danger" disabled=${busy} onClick=${() => void remove()}>
                  Remove uploaded certificate
                </button>`}
          </div>`
        : null}
    </div>`;
}
