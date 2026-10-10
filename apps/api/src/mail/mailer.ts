/**
 * Outgoing email.
 *
 * Everything here is built around one rule: **an install with no mail server
 * must work completely.** On-premise customers frequently have no SMTP relay
 * they are willing to give a new tool, and a product that degrades because
 * nobody filled in a mail form is a product that annoys the person evaluating
 * it. So sending is optional, never configured is a normal state, and a
 * failure to send is reported rather than thrown into the middle of something
 * that was otherwise succeeding.
 *
 * The password is encrypted at rest — see `lib/secrets.ts`.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { query } from "../db/pool.js";
import { encryptSecret, tryDecryptSecret } from "../lib/secrets.js";
import { product } from "../config.js";

/**
 * Providers whose settings are fixed and not worth making anybody type.
 *
 * A hosted mail service has exactly one host, one port and one username, and
 * asking an administrator to know that Resend's username is the word
 * "resend" is asking them to memorise our supplier's routing detail. They
 * have an API key; that should be the whole form.
 *
 * `custom` stays the default, because most on-premise installs point at their
 * own relay and no preset would ever fit it. Adding another provider here is
 * one entry — nothing else knows the difference.
 */
export const MAIL_PROVIDERS = {
  resend: {
    label: "Resend",
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    username: "resend",
    /** What the one secret is called on screen. */
    secretLabel: "Resend API key",
  },
} as const;

export type MailProvider = "custom" | keyof typeof MAIL_PROVIDERS;

export interface SmtpSettings {
  /** "custom" means the fields below are as typed; anything else fills them. */
  provider: MailProvider;
  enabled: boolean;
  host: string;
  port: number;
  /** True for implicit TLS (usually port 465). False means STARTTLS. */
  secure: boolean;
  username: string;
  /** Encrypted. Never leaves the server, never returned by the API. */
  passwordEnc: string;
  fromAddress: string;
  fromName: string;
  /**
   * Whether to insist the server's certificate is valid.
   *
   * Default true. Internal relays with a self-signed certificate are common
   * enough that turning it off has to be possible, but it has to be a
   * deliberate act with its consequence written next to it.
   */
  rejectUnauthorized: boolean;
}

/** What the browser is allowed to see: everything except the password. */
export type SafeSmtp = Omit<SmtpSettings, "passwordEnc"> & { hasPassword: boolean };

export const SMTP_DEFAULTS: SmtpSettings = {
  provider: "custom",
  enabled: false,
  host: "",
  port: 587,
  secure: false,
  username: "",
  passwordEnc: "",
  fromAddress: "",
  fromName: product.name,
  rejectUnauthorized: true,
};

/** Reads the stored settings, falling back to defaults for anything missing. */
export async function loadSmtp(): Promise<SmtpSettings> {
  const { rows } = await query<{ value: string }>(
    "select value from settings where key = 'smtp'",
  );
  if (!rows[0]) return { ...SMTP_DEFAULTS };
  try {
    return { ...SMTP_DEFAULTS, ...(JSON.parse(rows[0].value) as Partial<SmtpSettings>) };
  } catch {
    // Corrupt JSON should mean "not configured", not a broken settings screen.
    return { ...SMTP_DEFAULTS };
  }
}

/**
 * Applies a provider's fixed settings over whatever was submitted.
 *
 * Done on the server rather than in the form, so a stale browser tab or a
 * hand-written request cannot end up with Resend's API key being offered to
 * somebody else's mail server.
 */
export function applyProvider(settings: SmtpSettings): SmtpSettings {
  if (settings.provider === "custom") return settings;
  const preset = MAIL_PROVIDERS[settings.provider];
  if (!preset) return { ...settings, provider: "custom" };
  return {
    ...settings,
    host: preset.host,
    port: preset.port,
    secure: preset.secure,
    username: preset.username,
    // A hosted provider always presents a public certificate. There is no
    // reason to let this be turned off, and every reason not to.
    rejectUnauthorized: true,
  };
}

/** Strips the password before anything is sent to a browser. */
export function toSafe(settings: SmtpSettings): SafeSmtp {
  const { passwordEnc, ...rest } = settings;
  return { ...rest, hasPassword: Boolean(passwordEnc) };
}

export async function saveSmtp(settings: SmtpSettings): Promise<void> {
  await query(
    `insert into settings (key, value, updated_at)
     values ('smtp', $1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [JSON.stringify(settings)],
  );
}

/** Encrypts a password for storage. Exported so routes never touch the cipher. */
export function sealPassword(plain: string): string {
  return encryptSecret(plain);
}

/**
 * Why this configuration cannot send, or null if it can.
 *
 * Checked before a transport is built so the message names the missing field
 * instead of surfacing as a connection error twenty seconds later.
 */
export function whyNotSendable(s: SmtpSettings): string | null {
  if (!s.enabled) return "Email is turned off.";

  if (s.provider === "custom") {
    if (!s.host.trim()) return "No mail server is set.";
    if (s.username.trim() && !s.passwordEnc) return "A username is set but no password.";
  } else {
    const preset = MAIL_PROVIDERS[s.provider];
    if (!s.passwordEnc) return `No ${preset?.secretLabel ?? "API key"} is set.`;
  }

  if (!s.fromAddress.trim()) return "No 'from' address is set.";
  return null;
}

function buildTransport(s: SmtpSettings): Transporter {
  const password = tryDecryptSecret(s.passwordEnc);
  return nodemailer.createTransport({
    host: s.host.trim(),
    port: s.port,
    secure: s.secure,
    // Anonymous relays are normal on an internal network, so auth is only sent
    // when there is something to send.
    auth: s.username.trim() && password ? { user: s.username.trim(), pass: password } : undefined,
    tls: { rejectUnauthorized: s.rejectUnauthorized },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

function fromHeader(s: SmtpSettings): string {
  const name = s.fromName.trim();
  const address = s.fromAddress.trim();
  return name ? `"${name.replace(/"/g, "")}" <${address}>` : address;
}

export interface SendResult {
  sent: boolean;
  /** Present when `sent` is false. Written for a person, not for a log parser. */
  reason?: string;
}

export interface Message {
  to: string | string[];
  /** Copied in, so they can see who else was told. */
  cc?: string | string[];
  subject: string;
  text: string;
}

/**
 * Sends one message.
 *
 * Never throws. Callers are usually doing something else worth finishing — a
 * nightly job, a user action — and a mail server being down is not a reason to
 * fail that.
 */
export async function sendMail(message: Message, override?: SmtpSettings): Promise<SendResult> {
  const settings = override ?? (await loadSmtp());
  const blocked = whyNotSendable(settings);
  if (blocked) return { sent: false, reason: blocked };

  try {
    await buildTransport(settings).sendMail({
      from: fromHeader(settings),
      to: Array.isArray(message.to) ? message.to.join(", ") : message.to,
      cc: message.cc ? (Array.isArray(message.cc) ? message.cc.join(", ") : message.cc) : undefined,
      subject: message.subject,
      text: message.text,
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: explain(err) };
  }
}

/**
 * Opens a connection and authenticates, without sending anything.
 *
 * Used by the Test button. Verifying separately from sending means the screen
 * can tell "the server refused your password" apart from "the address you
 * typed does not exist".
 */
export async function verifySmtp(settings: SmtpSettings): Promise<SendResult> {
  const blocked = whyNotSendable({ ...settings, enabled: true });
  if (blocked) return { sent: false, reason: blocked };
  try {
    await buildTransport(settings).verify();
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: explain(err) };
  }
}

/**
 * Turns a mail library error into something an administrator can act on.
 *
 * The raw errors are accurate and useless: "ECONNREFUSED 10.0.0.5:587" tells
 * you what happened but not what to change.
 */
function explain(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; message?: string };
  const message = e.message ?? String(err);

  switch (e.code) {
    case "EAUTH":
      return "The mail server rejected the username or password.";
    case "ECONNREFUSED":
      return "Nothing is listening at that address and port. Check the host and port.";
    case "ETIMEDOUT":
    case "ESOCKET":
      return "Could not reach the mail server. Check the address, the port, and whether a firewall allows it.";
    case "EDNS":
    case "ENOTFOUND":
      return "That server name could not be found. Check the spelling.";
    default:
      break;
  }

  if (/self.signed|unable to verify|certificate/i.test(message)) {
    return (
      "The mail server's certificate could not be verified. If it uses an internal " +
      "certificate, turn off certificate checking — and understand that this stops " +
      "the connection being protected against interception."
    );
  }
  if (e.responseCode === 535) return "The mail server rejected the username or password.";
  if (e.responseCode === 550) return "The mail server refused the sender or recipient address.";

  return message;
}
