import { useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { auth, type SessionUser } from "../persistence/apiClient.js";
import { Brand } from "./Brand.js";

/**
 * Sign in, or create the very first administrator.
 *
 * An installation with no users at all shows the bootstrap form instead. The
 * server decides which — the browser only asks.
 */
export function Login({ needsBootstrap, onSignedIn }: {
  needsBootstrap: boolean;
  onSignedIn: (user: SessionUser) => void;
}): VNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** "Forgot password?" swaps the form for one that asks who the administrator is. */
  const [forgot, setForgot] = useState(false);
  const [forgotReply, setForgotReply] = useState("");

  async function requestTemporary(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const identifier = (form.elements.namedItem("identifier") as HTMLInputElement | null)?.value ?? "";
    setBusy(true);
    setError("");
    try {
      setForgotReply((await auth.forgot(identifier)).message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const backToSignIn = (): void => {
    setForgot(false);
    setForgotReply("");
    setError("");
  };

  if (forgot) {
    return html`
      <div class="center">
        <form class="login card" onSubmit=${requestTemporary}>
          <${Brand} />
          <div class="pad">
            <p style="margin:0 0 6px"><b>Forgot your password?</b></p>
            ${forgotReply
              ? html`<p class="muted" style="margin:0 0 16px" role="status">${forgotReply}</p>
                  <button type="button" class="btn primary" style="width:100%" onClick=${backToSignIn}>
                    Back to sign in
                  </button>`
              : html`
                  <p class="muted" style="margin:0 0 16px">
                    For administrators. Enter your username or email address and a temporary
                    password will be emailed to you. It works once, for 30 minutes.
                  </p>
                  ${error ? html`<div class="err" role="alert">${error}</div>` : null}
                  <label class="fld">
                    <span>Username or email address</span>
                    <input name="identifier" autocomplete="username" required autofocus />
                  </label>
                  <button class="btn primary" style="width:100%" disabled=${busy}>
                    ${busy ? "Sending…" : "Email me a temporary password"}
                  </button>
                  <button type="button" class="btn" style="width:100%;margin-top:8px" onClick=${backToSignIn}>
                    Back to sign in
                  </button>
                  <p class="muted" style="font-size:11.5px;margin:14px 0 0">
                    Not an administrator? Ask one of your administrators to reset your password.
                  </p>`}
          </div>
        </form>
      </div>`;
  }

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const value = (name: string): string =>
      (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";

    setBusy(true);
    setError("");
    try {
      const { user } = needsBootstrap
        ? await auth.bootstrap({
            username: value("username"),
            name: value("name"),
            email: value("email"),
            password: value("password"),
          })
        : await auth.login(value("username"), value("password"));
      onSignedIn(user);
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
          ${needsBootstrap
            ? html`<p class="muted" style="margin:0 0 16px">
                No accounts exist yet. Create the first administrator.
              </p>`
            : null}
          ${error ? html`<div class="err" role="alert">${error}</div>` : null}

          <label class="fld">
            <span>Username</span>
            <input name="username" autocomplete="username" required autofocus />
          </label>

          ${needsBootstrap
            ? html`
                <label class="fld"><span>Full name</span>
                  <input name="name" autocomplete="name" required />
                </label>
                <label class="fld"><span>Email</span>
                  <input name="email" type="email" autocomplete="email" required />
                </label>`
            : null}

          <label class="fld">
            <span>Password</span>
            <input
              name="password"
              type="password"
              autocomplete=${needsBootstrap ? "new-password" : "current-password"}
              required
              minLength=${needsBootstrap ? 12 : 1}
            />
          </label>
          ${needsBootstrap
            ? html`<p class="muted" style="font-size:11.5px;margin:-6px 0 14px">
                At least 12 characters. A memorable phrase beats a short, complicated word.
              </p>`
            : null}

          <button class="btn primary" style="width:100%" disabled=${busy}>
            ${busy ? "Working…" : needsBootstrap ? "Create administrator" : "Sign in"}
          </button>
          ${needsBootstrap
            ? null
            : html`<p style="text-align:center;margin:14px 0 0">
                <a href="#" onClick=${(e: Event) => { e.preventDefault(); setError(""); setForgot(true); }}>
                  Forgot password?
                </a>
              </p>`}
        </div>
      </form>
    </div>`;
}
