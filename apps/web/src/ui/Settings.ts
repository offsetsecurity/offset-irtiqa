import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import { Updates } from "./Updates.js";
import { Certificate } from "./Certificate.js";
import { ExampleData } from "./ExampleData.js";
import { Field } from "./Modal.js";
import {
  smtp, digest, MAIL_PROVIDERS,
  type SmtpSettings, type SessionUser, type MailProvider,
  type DigestSettings, type DigestPreview,
} from "../persistence/apiClient.js";

/**
 * Instance settings. Today: outgoing email.
 *
 * Administrators only, and not merely hidden from everyone else — the server
 * refuses these routes for any other role. The settings name an internal mail
 * server and an account on it, which is infrastructure detail rather than
 * compliance data.
 *
 * The screen is built around one fact: **an install with no mail server is
 * normal and must keep working.** Nothing here is required, nothing nags, and
 * the product does not behave differently until somebody turns it on.
 */

/** Everything the form edits. `hasPassword` is read-only, from the server. */
type Draft = Omit<SmtpSettings, "hasPassword">;

const EMPTY: Draft = {
  provider: "custom",
  enabled: false,
  host: "",
  port: 587,
  secure: false,
  username: "",
  fromAddress: "",
  fromName: "",
  rejectUnauthorized: true,
};

type Note = { kind: "ok" | "err"; text: string } | null;

export function Settings({ me, features }: {
  me: SessionUser;
  /** The pack's feature flags, for the sections not every product has. */
  features: Record<string, boolean>;
}): VNode {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [hasPassword, setHasPassword] = useState(false);
  /**
   * Empty means "leave the stored password alone".
   *
   * The server never sends the password back, so the field starts blank on
   * every load. Without this rule, saving a change to the port would clear the
   * password every time.
   */
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);

  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  const [testTo, setTestTo] = useState(me.email ?? "");
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<Note>(null);

  // ── the daily digest ──────────────────────────────────────────────────────
  const [dig, setDig] = useState<DigestSettings>({
    enabled: false,
    recipients: [],
    sendWhenEmpty: false,
    horizonDays: 14,
  });
  // Edited as text, one address per line: a list is easier to paste into and
  // easier to read back than a row of chips.
  const [digTo, setDigTo] = useState("");
  const [digBusy, setDigBusy] = useState(false);
  const [digNote, setDigNote] = useState<Note>(null);
  const [preview, setPreview] = useState<DigestPreview | null>(null);

  const patchDig = (change: Partial<DigestSettings>): void =>
    setDig((current) => ({ ...current, ...change }));

  const addressesFrom = (text: string): string[] =>
    text.split(/[\n,;]+/).map((a) => a.trim()).filter(Boolean);

  // Functional updates throughout: a captured draft goes stale the moment two
  // fields change close together, and a browser autofilling four boxes at once
  // does exactly that.
  const patch = (change: Partial<Draft>): void =>
    setDraft((current) => ({ ...current, ...change }));

  useEffect(() => {
    let live = true;
    smtp
      .get()
      .then((s) => {
        if (!live) return;
        const { hasPassword: stored, ...rest } = s;
        setDraft(rest);
        setHasPassword(stored);
      })
      .catch(() => live && setNote({ kind: "err", text: "Could not load the email settings." }))
      .finally(() => live && setLoaded(true));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    digest
      .get()
      .then((d) => {
        if (!live) return;
        setDig(d);
        setDigTo(d.recipients.join("\n"));
      })
      .catch(() => { /* the mail settings above still work without this */ });
    return () => { live = false; };
  }, []);

  async function saveDigest(event: Event): Promise<void> {
    event.preventDefault();
    setDigBusy(true);
    setDigNote(null);
    try {
      const saved = await digest.save({ ...dig, recipients: addressesFrom(digTo) });
      setDig(saved);
      setDigTo(saved.recipients.join("\n"));
      setDigNote({ kind: "ok", text: "Saved." });
    } catch (err) {
      setDigNote({ kind: "err", text: (err as Error).message });
    } finally {
      setDigBusy(false);
    }
  }

  async function showPreview(): Promise<void> {
    setDigBusy(true);
    setDigNote(null);
    try {
      setPreview(await digest.preview());
    } catch (err) {
      setDigNote({ kind: "err", text: (err as Error).message });
    } finally {
      setDigBusy(false);
    }
  }

  async function sendDigestNow(): Promise<void> {
    setDigBusy(true);
    setDigNote(null);
    try {
      const r = await digest.send();
      setDigNote(
        r.ok
          ? { kind: "ok", text: `Sent to ${(r.to ?? []).join(", ")}.` }
          : { kind: "err", text: r.reason ?? "It could not be sent." },
      );
    } catch (err) {
      setDigNote({ kind: "err", text: (err as Error).message });
    } finally {
      setDigBusy(false);
    }
  }

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setNote(null);
    setTestNote(null);
    try {
      const body: Draft & { password?: string } = { ...draft };
      if (clearPassword) body.password = "";
      else if (password) body.password = password;

      const saved = await smtp.save(body);
      const { hasPassword: stored, ...rest } = saved;
      setDraft(rest);
      setHasPassword(stored);
      setPassword("");
      setClearPassword(false);
      setNote({ kind: "ok", text: "Saved." });
    } catch (err) {
      setNote({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Tests what is saved, not what is on screen.
   *
   * Anything else would answer a question nobody asked: whether settings that
   * are not in effect would have worked.
   */
  async function sendTest(): Promise<void> {
    setTesting(true);
    setTestNote(null);
    try {
      const result = await smtp.test(testTo.trim());
      setTestNote(
        result.ok
          ? { kind: "ok", text: `Sent. Check ${result.to} — including the spam folder.` }
          : {
              kind: "err",
              text:
                result.stage === "connect"
                  ? `Could not reach the mail server. ${result.reason ?? ""}`.trim()
                  : `Connected, but the message was refused. ${result.reason ?? ""}`.trim(),
            },
      );
    } catch (err) {
      setTestNote({ kind: "err", text: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  const provider = MAIL_PROVIDERS[draft.provider] ?? MAIL_PROVIDERS.custom;
  const isCustom = draft.provider === "custom";

  if (!loaded) return html`<div class="card pad muted">Loading…</div>`;

  const noteLine = (n: Note): VNode | null =>
    n ? html`<div class=${n.kind === "ok" ? "ok-note" : "err"}>${n.text}</div>` : null;

  return html`
    <div class="settings-stack">
      <${Updates} />

      <${Certificate} />

      ${features["demoData"] ? html`<${ExampleData} />` : null}

      <form class="card pad" onSubmit=${save}>
        <h2 class="section-h">Outgoing email</h2>
        <p class="muted section-note">
          Optional. Everything in this product works without a mail server; email only
          adds notifications on top. Nothing is sent until you turn it on below.
        </p>

        ${noteLine(note)}

        <div class="form-grid">
          <${Field} label="Mail provider" wide=${true}
                    hint=${provider.note || "Choose a service, or fill in any SMTP server yourself."}>
            <select value=${draft.provider}
                    onInput=${(e: Event) => {
                      const next = (e.target as HTMLSelectElement).value as MailProvider;
                      // The secret belongs to the old provider, so drop what was
                      // typed. The server clears the stored one to match.
                      setPassword("");
                      setClearPassword(false);
                      patch({ provider: next });
                    }}>
              ${(Object.keys(MAIL_PROVIDERS) as MailProvider[]).map(
                (id) => html`<option value=${id}>${MAIL_PROVIDERS[id].label}</option>`,
              )}
            </select>
          <//>

          ${isCustom
            ? html`<>
                <${Field} label="Mail server" wide=${true}
                          hint="The host name or address of your SMTP relay.">
                  <input value=${draft.host} placeholder="smtp.example.com"
                         onInput=${(e: Event) =>
                           patch({ host: (e.target as HTMLInputElement).value })} />
                <//>

                <${Field} label="Port">
                  <input type="number" min="1" max="65535" value=${String(draft.port)}
                         onInput=${(e: Event) =>
                           patch({ port: Number((e.target as HTMLInputElement).value) || 0 })} />
                <//>

                <${Field} label="Encryption"
                          hint="STARTTLS is the usual choice and normally uses port 587.">
                  <select value=${draft.secure ? "tls" : "starttls"}
                          onInput=${(e: Event) => {
                            const tls = (e.target as HTMLSelectElement).value === "tls";
                            // Move the port with it: the pair is almost always
                            // 587/STARTTLS or 465/TLS, and getting it wrong is the
                            // most common way this fails.
                            patch({ secure: tls, port: tls ? 465 : 587 });
                          }}>
                    <option value="starttls">STARTTLS (port 587)</option>
                    <option value="tls">TLS from the start (port 465)</option>
                  </select>
                <//>

                <${Field} label="Username"
                          hint="Leave this and the password blank if your relay needs no sign-in.">
                  <input value=${draft.username} autocomplete="off"
                         onInput=${(e: Event) =>
                           patch({ username: (e.target as HTMLInputElement).value })} />
                <//>
              </>`
            : null}

          <${Field} label=${provider.secretLabel} wide=${!isCustom}
                    hint=${hasPassword && !clearPassword
                      ? `A ${provider.inlineLabel} is saved. Leave blank to keep it.`
                      : "Stored encrypted, and never shown again."}>
            <input type="password" value=${password} autocomplete="new-password"
                   disabled=${clearPassword}
                   placeholder=${hasPassword && !clearPassword ? "unchanged" : ""}
                   onInput=${(e: Event) => setPassword((e.target as HTMLInputElement).value)} />
          <//>

          ${hasPassword
            ? html`<label class="fld wide check">
                <input type="checkbox" checked=${clearPassword}
                       onChange=${(e: Event) => {
                         setClearPassword((e.target as HTMLInputElement).checked);
                         setPassword("");
                       }} />
                <span>Forget the saved ${provider.inlineLabel}</span>
              </label>`
            : null}

          <${Field} label="From address" hint="The address notifications appear to come from.">
            <input type="email" value=${draft.fromAddress} placeholder="grc@example.com"
                   onInput=${(e: Event) =>
                     patch({ fromAddress: (e.target as HTMLInputElement).value })} />
          <//>

          <${Field} label="From name">
            <input value=${draft.fromName}
                   onInput=${(e: Event) =>
                     patch({ fromName: (e.target as HTMLInputElement).value })} />
          <//>

          ${isCustom
            ? html`<label class="fld wide check">
                <input type="checkbox" checked=${draft.rejectUnauthorized}
                       onChange=${(e: Event) =>
                         patch({ rejectUnauthorized: (e.target as HTMLInputElement).checked })} />
                <span>
                  Check the mail server's certificate
                  <em class="hint">
                    Turn this off only for an internal server with its own certificate. With it
                    off, the connection is encrypted but not protected against interception.
                  </em>
                </span>
              </label>`
            : null}

          <label class="fld wide check">
            <input type="checkbox" checked=${draft.enabled}
                   onChange=${(e: Event) =>
                     patch({ enabled: (e.target as HTMLInputElement).checked })} />
            <span>
              Send email from this instance
              <em class="hint">Test it first. Saving this on with anything missing is refused.</em>
            </span>
          </label>
        </div>

        <div class="row-actions form-actions">
          <button class="btn primary" type="submit" disabled=${busy}>
            ${busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      <div class="card pad">
        <h2 class="section-h">Send a test message</h2>
        <p class="muted section-note">
          Uses the settings as saved above, whether or not sending is turned on. Save first,
          then test.
        </p>

        ${noteLine(testNote)}

        <div class="form-grid">
          <${Field} label="Send to" wide=${true}>
            <input type="email" value=${testTo} placeholder="you@example.com"
                   onInput=${(e: Event) => setTestTo((e.target as HTMLInputElement).value)} />
          <//>
        </div>

        <div class="row-actions form-actions">
          <button class="btn" type="button"
                  disabled=${testing || !testTo.trim() || (isCustom && !draft.host.trim())}
                  onClick=${sendTest}>
            ${testing ? "Sending…" : "Send test email"}
          </button>
        </div>
      </div>

      <form class="card pad" onSubmit=${saveDigest}>
        <h2 class="section-h">Daily digest</h2>
        <p class="muted section-note">
          One message a day listing what needs attention: evidence out of date, overdue
          tasks and findings, policies due for review, and open risks in the top band.
          It is sent after the nightly readiness snapshot.
        </p>

        ${noteLine(digNote)}

        <div class="form-grid">
          <${Field} label="Send to" wide=${true}
                    hint="One address per line. Leave it empty and it goes to every administrator who has an email address.">
            <textarea rows="3" value=${digTo} placeholder="everyone with an admin account"
                      onInput=${(e: Event) => setDigTo((e.target as HTMLTextAreaElement).value)}
            ></textarea>
          <//>

          <${Field} label="Look ahead"
                    hint="How far ahead to warn about things coming due.">
            <select value=${String(dig.horizonDays)}
                    onInput=${(e: Event) =>
                      patchDig({ horizonDays: Number((e.target as HTMLSelectElement).value) })}>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
            </select>
          <//>

          <label class="fld wide check">
            <input type="checkbox" checked=${dig.sendWhenEmpty}
                   onChange=${(e: Event) =>
                     patchDig({ sendWhenEmpty: (e.target as HTMLInputElement).checked })} />
            <span>
              Send even when nothing needs attention
              <em class="hint">
                Off by default. A message that arrives every day saying nothing trains
                people to ignore it, and the morning it matters they will not read that
                one either. Turn it on if you want the daily all-clear as proof the tool
                is still running.
              </em>
            </span>
          </label>

          <label class="fld wide check">
            <input type="checkbox" checked=${dig.enabled}
                   onChange=${(e: Event) =>
                     patchDig({ enabled: (e.target as HTMLInputElement).checked })} />
            <span>
              Send the digest every day
              <em class="hint">Needs the mail settings above to be working.</em>
            </span>
          </label>
        </div>

        <div class="row-actions form-actions">
          <button class="btn primary" type="submit" disabled=${digBusy}>
            ${digBusy ? "Working…" : "Save"}
          </button>
          <button class="btn" type="button" disabled=${digBusy} onClick=${showPreview}>
            Preview today's
          </button>
          <button class="btn" type="button" disabled=${digBusy} onClick=${sendDigestNow}>
            Send it now
          </button>
        </div>

        ${preview
          ? html`<div class="preview">
              <div class="preview-head">
                <strong>${preview.subject}</strong>
                <span class="muted">
                  ${preview.recipients.length
                    ? `to ${preview.recipients.join(", ")}`
                    : "nobody would receive this"}
                </span>
              </div>
              ${!preview.wouldSend
                ? html`<div class="muted preview-note">
                    Nothing needs attention, so tonight it would send nothing.
                  </div>`
                : null}
              <pre>${preview.body}</pre>
            </div>`
          : null}
      </form>
    </div>`;
}
