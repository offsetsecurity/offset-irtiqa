import { useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { auth, type SessionUser } from "../persistence/apiClient.js";
import { AuthFrame, PasswordMeter } from "./Login.js";
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
  const [pw, setPw] = useState("");

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
    <${AuthFrame} title="Choose a new password"
      lede=${html`You signed in as <b>${user.username}</b> with a temporary password. It has now been used up, so choose the password you will use from now on.`}>
      <form class="auth-fields" onSubmit=${submit}>
        ${error ? html`<div class="err" role="alert">${error}</div>` : null}
        <label class="fld">
          <span>New password</span>
          <input name="newPassword" type="password" autocomplete="new-password"
                 required minLength=${MIN_LENGTH} autofocus onInput=${(e: Event) => setPw((e.target as HTMLInputElement).value)} />
        </label>
        <${PasswordMeter} value=${pw} min=${MIN_LENGTH} />
        <label class="fld">
          <span>New password again</span>
          <input name="again" type="password" autocomplete="new-password" required />
        </label>
        <button class="btn primary auth-go" disabled=${busy}>
          ${busy ? "Saving…" : "Save and continue"}
        </button>
        <button type="button" class="btn ghost auth-go" onClick=${onSignOut}>
          Sign out
        </button>
      </form>
    <//>`;
}

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
