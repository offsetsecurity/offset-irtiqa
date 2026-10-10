import { useEffect, useRef, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import {
  health, updates, type UpdateCheck, type UpdatesOverview, type UpdateState,
} from "../persistence/apiClient.js";

/**
 * Settings → Updates.
 *
 * Three things an administrator needs, in order: which version this is,
 * whether there is a newer one worth having, and - once they ask for it - what
 * is happening, in words, until it is finished.
 *
 * Nothing here checks by itself. A customer's server contacts the internet
 * only when somebody presses the button, so a security team reviewing outbound
 * traffic never finds this product phoning home on a timer.
 */

const HOW: Record<UpdatesOverview["installKind"], string> = {
  docker: "Docker",
  linux: "the Linux installer",
  windows: "the Windows installer",
  none: "no updater",
};

const IN_PROGRESS: UpdateState[] = ["queued", "downloading", "installing", "verifying"];

const STEP: Record<UpdateState, string> = {
  queued: "Checking the release",
  downloading: "Downloading",
  installing: "Installing and restarting",
  verifying: "Checking the new version started",
  done: "Updated",
  failed: "Update failed",
  rolled_back: "Update undone",
};

const date = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";

export function Updates(): VNode {
  const [data, setData] = useState<UpdatesOverview | null>(null);
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  /** Set once an update is under way and the server has gone quiet to restart. */
  const [restarting, setRestarting] = useState(false);
  /** The version the page was loaded against, so a finished update can ask for a reload. */
  const loadedVersion = useRef<string | null>(null);
  const [reloadNeeded, setReloadNeeded] = useState(false);

  async function load(): Promise<void> {
    const d = await updates.get();
    loadedVersion.current ??= d.current;
    setData(d);
    setCheck(d.lastCheck);
    if (d.current !== loadedVersion.current) setReloadNeeded(true);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const active = data?.status && IN_PROGRESS.includes(data.status.state);

  // While an update runs, keep asking. The server stops answering while it
  // restarts; that is expected, and is reported as such rather than as a fault.
  useEffect(() => {
    if (!active && !restarting) return undefined;
    const timer = setInterval(() => {
      load()
        .then(() => setRestarting(false))
        .catch(() => {
          setRestarting(true);
          health()
            .then((h) => {
              if (loadedVersion.current && h.version !== loadedVersion.current) setReloadNeeded(true);
            })
            .catch(() => undefined);
        });
    }, 3000);
    return () => clearInterval(timer);
  }, [active, restarting]);

  async function runCheck(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      setCheck(await updates.check());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function apply(version: string): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await updates.apply(version);
      setConfirming(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return html`<div class="card pad">
      <h2 class="section-h">Updates</h2>
      ${error ? html`<div class="err">${error}</div>` : html`<p class="muted">Loading…</p>`}
    </div>`;
  }

  const status = data.status;
  const canInstall = data.installKind !== "none";

  return html`
    <div class="card pad">
      <h2 class="section-h">Updates</h2>
      <p class="muted section-note">
        This is version <b>${data.current}</b>, installed with ${HOW[data.installKind]}.
        Checking contacts the Offset release server, and only when you press the button.
      </p>

      ${data.customKeys
        ? html`<div class="err">
            This server trusts a signing key set in its configuration instead of Offset
            Security's. That is for testing a release pipeline only.
          </div>`
        : null}

      ${reloadNeeded
        ? html`<div class="ok-note">
            Updated. Reload this page to use the new version.
            <button type="button" class="btn small" style="margin-left:10px"
              onClick=${() => location.reload()}>Reload</button>
          </div>`
        : null}

      ${restarting
        ? html`<p class="muted">Restarting on the new version. This page will catch up by itself.</p>`
        : null}

      ${status && !reloadNeeded
        ? html`<div class=${status.state === "done" ? "ok-note" : status.state === "failed" || status.state === "rolled_back" ? "err" : "muted"}>
            <b>${STEP[status.state]}${IN_PROGRESS.includes(status.state) ? "…" : ""}</b>
            ${status.state === "done" ? ` to ${status.version}` : ` (${status.from} to ${status.version})`}.
            ${status.message ? html` ${status.message}` : null}
            <span class="muted"> ${date(status.updatedAt)}</span>
          </div>`
        : null}

      ${error ? html`<div class="err">${error}</div>` : null}

      ${check?.error ? html`<div class="err">${check.error}</div>` : null}

      ${check && !check.error && !check.newer
        ? html`<p>You have the latest version. <span class="muted">Checked ${date(check.checkedAt)}.</span></p>`
        : null}

      ${check?.newer && check.latest
        ? html`<div class="update-offer">
            <p>
              <b>Version ${check.latest} is available.</b>
              <span class="muted"> Released ${date(check.published)}.</span>
            </p>
            ${check.notes ? html`<pre class="update-notes">${check.notes}</pre>` : null}

            ${!canInstall
              ? html`<p class="muted">
                  This copy was not installed with an updater, so it cannot update itself.
                  Install ${check.latest} with its installer; your data is kept.
                </p>`
              : !check.installable
              ? html`<p class="muted">
                  This release has no one-click package for ${HOW[data.installKind]}.
                  Use its installer instead.
                </p>`
              : !data.updater.present
              ? html`<p class="muted">
                  ${data.installKind === "docker"
                    ? "The updater container is not running. Add COMPOSE_PROFILES=updates to .env, then run docker compose up -d."
                    : "The updater for this install is missing. Run the latest installer once to add it."}
                </p>`
              : null}
          </div>`
        : null}

      ${confirming && check?.latest
        ? html`<div class="confirm">
            <div><b>Update to ${check.latest}?</b></div>
            <p class="muted" style="margin:6px 0 0">
              A backup of the database is taken first. The application is
              unavailable for a minute or two while it restarts. If the new version does not
              start properly, the previous one and the database are put back automatically.
            </p>
            <div class="confirm-actions">
              <button type="button" class="btn small" onClick=${() => setConfirming(false)}>Cancel</button>
              <button type="button" class="btn small primary" disabled=${busy}
                onClick=${() => void apply(check.latest!)}>Update now</button>
            </div>
          </div>`
        : null}

      <div class="confirm-actions" style="justify-content:flex-start">
        <button type="button" class="btn" disabled=${busy || Boolean(active)} onClick=${() => void runCheck()}>
          ${busy && !confirming ? "Checking…" : "Check for updates"}
        </button>
        ${check?.newer && check.installable && canInstall && data.updater.present && !confirming && !active
          ? html`<button type="button" class="btn primary" disabled=${busy}
                   onClick=${() => setConfirming(true)}>
              Update to ${check.latest}
            </button>`
          : null}
      </div>
    </div>
  `;
}
