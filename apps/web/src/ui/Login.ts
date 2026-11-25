import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren, VNode } from "preact";
import { html } from "./html.js";
import { auth, type SessionUser } from "../persistence/apiClient.js";
import { ProductMark } from "./Brand.js";

const PRODUCT_NAME = import.meta.env.PRODUCT_NAME as unknown as string;
const FRAMEWORK = import.meta.env.FRAMEWORK as unknown as string;

/**
 * What the left of the sign-in screen shows: what the product does, drawn as a
 * small moving picture of it, not a stock photo. Each line ticks in turn, the
 * ring fills, and then it rests.
 */
const PREVIEW = [
  { ref: "A.5.15", text: "Access reviewed, evidence filed" },
  { ref: "A.8.8", text: "Technical vulnerabilities managed" },
  { ref: "A.5.1", text: "Policies approved and published" },
  { ref: "A.5.19", text: "Suppliers' assurance on file" },
];

function Showcase(): VNode {
  // Count the ring up once, after the panel has drawn.
  const [pct, setPct] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setPct(92); return undefined; }
    let raf = 0;
    const t0 = performance.now() + 500;
    const step = (t: number): void => {
      const k = Math.min(1, Math.max(0, (t - t0) / 1600));
      setPct(Math.round(92 * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  const C = 2 * Math.PI * 42;
  return html`
    <aside class="auth-show" aria-hidden="true">
      <div class="aurora"><i></i><i></i><i></i></div>
      <div class="auth-show-in">
        <div class="auth-mark"><span class="ptile"><${ProductMark} /></span><b>${PRODUCT_NAME}</b></div>
        <div class="auth-pitch">
          <h2>${FRAMEWORK}, without the scramble.</h2>
          <p>Every control turned into a plan you can finish, with the evidence, the auditor and the report in one place.</p>
        </div>
        <div class="auth-card">
          <div class="auth-card-top">
            <svg class="auth-ring" viewBox="0 0 100 100">
              <defs><linearGradient id="authg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#7EA2FF" /><stop offset="1" stop-color="#3DD9BE" />
              </linearGradient></defs>
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="9" />
              <circle cx="50" cy="50" r="42" fill="none" stroke="url(#authg)" stroke-width="9" stroke-linecap="round"
                      stroke-dasharray=${C} stroke-dashoffset=${C * (1 - pct / 100)} transform="rotate(-90 50 50)" />
            </svg>
            <div>
              <div class="auth-pct">${pct}%</div>
              <div class="auth-lbl">ready for certification</div>
            </div>
          </div>
          <ul class="auth-ticks">
            ${PREVIEW.map((p, i) => html`
              <li style=${`animation-delay:${900 + i * 260}ms`}>
                <span class="tk"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" pathLength="24" style=${`animation-delay:${1050 + i * 260}ms`} /></svg></span>
                <code>${p.ref}</code><span>${p.text}</span>
              </li>`)}
          </ul>
        </div>
        <div class="auth-foot">
          <span>On your own server</span><span>Open source</span><span>Your data never leaves</span>
        </div>
      </div>
    </aside>`;
}

/** The sign-in, first-run and new-password screens share this frame. */
export function AuthFrame({ title, lede, children }: { title: string; lede?: ComponentChildren; children: ComponentChildren }): VNode {
  return html`
    <div class="auth">
      <${Showcase} />
      <main class="auth-main">
        <div class="auth-form login">
          <div class="auth-mobile-mark"><span class="ptile"><${ProductMark} /></span><b>${PRODUCT_NAME}</b></div>
          <h1>${title}</h1>
          ${lede ? html`<p class="auth-lede">${lede}</p>` : null}
          ${children}
        </div>
        <div class="auth-legal">${PRODUCT_NAME} · Developed by Offset Security</div>
      </main>
    </div>`;
}

/** How long a new password is, against the 12 the server asks for. */
export function PasswordMeter({ value, min = 12 }: { value: string; min?: number }): VNode {
  const k = Math.min(1, value.length / (min + 8));
  const ok = value.length >= min;
  const words = value.trim().split(/\s+/).filter(Boolean).length;
  const say = !value ? `At least ${min} characters. A memorable phrase beats a short, complicated word.`
    : !ok ? `${min - value.length} more character${min - value.length === 1 ? "" : "s"}`
    : words >= 3 || value.length >= 20 ? "Strong: long and memorable" : "Long enough. Longer is stronger";
  return html`
    <div class=${`pw-meter${ok ? " ok" : ""}`} aria-live="polite">
      <div class="pw-track"><span style=${`transform:scaleX(${value ? Math.max(.06, k) : 0})`}></span></div>
      <div class="pw-say">${say}</div>
    </div>`;
}

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
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);

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
      <${AuthFrame} title="Forgot your password?"
        lede="For administrators. Enter your username or email address and a temporary password will be emailed to you. It works once, for 30 minutes.">
        <form class="auth-fields" onSubmit=${requestTemporary}>
          ${forgotReply
            ? html`<div class="auth-sent" role="status">${forgotReply}</div>
                <button type="button" class="btn primary auth-go" onClick=${backToSignIn}>Back to sign in</button>`
            : html`
                ${error ? html`<div class="err" role="alert">${error}</div>` : null}
                <label class="fld">
                  <span>Username or email address</span>
                  <input name="identifier" autocomplete="username" required autofocus />
                </label>
                <button class="btn primary auth-go" disabled=${busy}>
                  ${busy ? "Sending…" : "Email me a temporary password"}
                </button>
                <button type="button" class="btn ghost auth-go" onClick=${backToSignIn}>Back to sign in</button>
                <p class="auth-note">Not an administrator? Ask one of your administrators to reset your password.</p>`}
        </form>
      <//>`;
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
    <${AuthFrame}
      title=${needsBootstrap ? `Set up ${PRODUCT_NAME.replace(/^Offset\s+/, "")}` : "Welcome back"}
      lede=${needsBootstrap
        ? "No accounts exist yet. Create the first administrator; you can invite your team once you are in."
        : `Sign in to ${PRODUCT_NAME}.`}>
      <form class="auth-fields" onSubmit=${submit}>
        ${error ? html`<div class="err" role="alert">${error}</div>` : null}

        ${needsBootstrap
          ? html`
              <div class="form-pair">
                <label class="fld"><span>Full name</span>
                  <input name="name" autocomplete="name" required autofocus />
                </label>
                <label class="fld"><span>Username</span>
                  <input name="username" autocomplete="username" required />
                </label>
              </div>
              <label class="fld"><span>Email</span>
                <input name="email" type="email" autocomplete="email" required />
              </label>`
          : html`<label class="fld">
              <span>Username</span>
              <input name="username" autocomplete="username" required autofocus />
            </label>`}

        <label class="fld">
          <span class="fld-row">Password
            ${needsBootstrap
              ? null
              : html`<a href="#" class="auth-forgot" onClick=${(e: Event) => { e.preventDefault(); setError(""); setForgot(true); }}>
                  Forgot password?
                </a>`}
          </span>
          <span class="pw-wrap">
            <input
              name="password"
              type=${show ? "text" : "password"}
              autocomplete=${needsBootstrap ? "new-password" : "current-password"}
              required
              minLength=${needsBootstrap ? 12 : 1}
              onInput=${(e: Event) => setPw((e.target as HTMLInputElement).value)}
            />
            <button type="button" class="pw-show" onClick=${() => setShow((v) => !v)}
                    aria-label=${show ? "Hide password" : "Show password"} title=${show ? "Hide password" : "Show password"}>
              ${show ? "Hide" : "Show"}
            </button>
          </span>
        </label>
        ${needsBootstrap ? html`<${PasswordMeter} value=${pw} />` : null}

        <button class="btn primary auth-go" disabled=${busy}>
          ${busy ? "Working…" : needsBootstrap ? "Create administrator" : "Sign in"}
        </button>
      </form>
    <//>`;
}
