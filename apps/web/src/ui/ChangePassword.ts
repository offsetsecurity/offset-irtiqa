import { useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { auth, type SessionUser } from "../persistence/apiClient.js";
import { Brand } from "./Brand.js";
import { Field, Modal } from "./Modal.js";

/**
 * Choosing a new password.
 *
 * Two ways in. After signing in with a temporary password it is the whole
 * screen, because the server allows nothing else until it is done. From the
 * top bar it is a dialog, and asks for the current password first.
 */

const MIN_LENGTH = 12;

function check(next: string, again: string): string {
  if (next.length < MIN_LENGTH) return `The new password needs at least ${MIN_LENGTH} characters.`;
  if (next !== again) return "The two new passwords are not the same.";
  return "";
}

/** The full screen, straight after signing in with a temporary password. */
export function ChooseNewPassword({ user, onDone, onSignOut }: {
  user: SessionUser;
  onDone: (user: SessionUser) => void;
  onSignOut: () => void;
}): VNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const value = (name: string): string =>
      (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
    const problem = check(value("newPassword"), value("again"));
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { user: updated } = await auth.changePassword({ newPassword: value("newPassword") });
      onDone(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="center">
      <form class="login card" onSubmit=${submit}>
        <${Brand} />
        <div class="pad">
          <p style="margin:0 0 6px"><b>Choose a new password</b></p>
          <p class="muted" style="margin:0 0 16px">
            You signed in as <b>${user.username}</b> with a temporary password. It has now
            been used up, so choose the password you will use from now on.
          </p>
          ${error ? html`<div class="err" role="alert">${error}</div>` : null}

          <label class="fld">
            <span>New password</span>
            <input name="newPassword" type="password" autocomplete="new-password"
                   required minLength=${MIN_LENGTH} autofocus />
          </label>
          <label class="fld">
            <span>New password again</span>
            <input name="again" type="password" autocomplete="new-password" required />
          </label>
          <p class="muted" style="font-size:11.5px;margin:-6px 0 14px">
            At least ${MIN_LENGTH} characters. A memorable phrase beats a short, complicated word.
          </p>

          <button class="btn primary" style="width:100%" disabled=${busy}>
            ${busy ? "Saving…" : "Save and continue"}
          </button>
          <button type="button" class="btn" style="width:100%;margin-top:8px" onClick=${onSignOut}>
            Sign out
          </button>
        </div>
      </form>
    </div>`;
}

/** The dialog from the top bar, for anyone who knows their current password. */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }): VNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    if (done) {
      onClose();
      return;
    }
    const form = e.target as HTMLFormElement;
    const value = (name: string): string =>
      (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
    const problem = check(value("newPassword"), value("again"));
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await auth.changePassword({
        currentPassword: value("currentPassword"),
        newPassword: value("newPassword"),
      });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return html`
    <${Modal} title="Change your password" onClose=${onClose} onSubmit=${submit}
              submitLabel=${done ? "Close" : "Change password"} busy=${busy} error=${error}>
      ${done
        ? html`<p class="ok-note" style="margin:0">
            Your password has been changed. Anywhere else you were signed in has been signed out.
          </p>`
        : html`
            <${Field} label="Current password">
              <input name="currentPassword" type="password" autocomplete="current-password" required />
            <//>
            <${Field} label="New password" hint=${`At least ${MIN_LENGTH} characters.`}>
              <input name="newPassword" type="password" autocomplete="new-password"
                     required minLength=${MIN_LENGTH} />
            <//>
            <${Field} label="New password again">
              <input name="again" type="password" autocomplete="new-password" required />
            <//>`}
    <//>`;
}
