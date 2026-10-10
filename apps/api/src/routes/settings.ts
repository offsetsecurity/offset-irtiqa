import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../db/pool.js";
import { canRead, isAdmin, requireAuth } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { badRequest } from "../lib/errors.js";
import { probeLogo } from "../reports/pdf.js";
import {
  applyProvider, loadSmtp, MAIL_PROVIDERS, saveSmtp, sealPassword, sendMail,
  toSafe, verifySmtp, whyNotSendable,
  type MailProvider, type SmtpSettings,
} from "../mail/mailer.js";
import { product } from "../config.js";
import {
  buildDigest, digestRecipients, loadDigest, saveDigest,
  type DigestSettings,
} from "../mail/digest.js";

/**
 * Instance settings. Today this is branding — the customer's own logo on the
 * reports they hand to their auditor.
 *
 * Stored in the `settings` table as JSON rather than a column, because these
 * are operator preferences that will grow, and none of them are queried.
 */

const MAX_BYTES = 512 * 1024;

const PROVIDER_IDS = ["custom", ...Object.keys(MAIL_PROVIDERS)] as [string, ...string[]];

const smtpBody = z
  .object({
    provider: z.enum(PROVIDER_IDS).default("custom"),
    enabled: z.boolean(),
    host: z.string().max(255).default(""),
    port: z.coerce.number().int().min(1).max(65535).default(587),
    secure: z.boolean().default(false),
    username: z.string().max(255).default(""),
    /**
     * Omitted keeps the stored password; an empty string clears it.
     *
     * The distinction matters: the form never receives the current password,
     * so without it, saving any other field would wipe the password every
     * time.
     */
    password: z.string().max(1024).optional(),
    fromAddress: z.string().max(320).default(""),
    fromName: z.string().max(120).default(""),
    rejectUnauthorized: z.boolean().default(true),
  })
  .strict();

const smtpTestBody = z.object({ to: z.string().email("That is not an email address.") }).strict();

const digestBody = z
  .object({
    enabled: z.boolean(),
    /** Empty means every enabled administrator, resolved when it is sent. */
    recipients: z.array(z.string().email("That is not an email address.")).max(50).default([]),
    sendWhenEmpty: z.boolean().default(false),
    horizonDays: z.coerce.number().int().min(1).max(365).default(14),
  })
  .strict();

/** Keep, clear, or replace — see the note on the `password` field above. */
function nextPassword(existing: string, provided: string | undefined): string {
  if (provided === undefined) return existing;
  if (provided === "") return "";
  return sealPassword(provided);
}

/** What is safe to write into the audit trail: everything except the secret. */
function smtpAuditView(s: SmtpSettings): Record<string, unknown> {
  return {
    provider: s.provider,
    enabled: s.enabled,
    host: s.host,
    port: s.port,
    secure: s.secure,
    username: s.username,
    fromAddress: s.fromAddress,
    rejectUnauthorized: s.rejectUnauthorized,
    hasPassword: Boolean(s.passwordEnc),
  };
}

const logoBody = z
  .object({
    /** A data URI for PNG/JPEG, or raw SVG markup. Null clears the logo. */
    logo: z
      .object({
        kind: z.enum(["image", "svg"]),
        data: z.string().min(1).max(1_400_000),
        filename: z.string().max(200).default(""),
      })
      .nullable(),
  })
  .strict();

export interface StoredLogo {
  kind: "image" | "svg";
  data: string;
  filename: string;
  bytes: number;
}

/** Reads the branding settings, or an empty object if never set. */
export async function loadBranding(): Promise<{ logo: StoredLogo | null }> {
  const { rows } = await query<{ value: string }>(
    "select value from settings where key = 'branding'",
  );
  if (!rows[0]) return { logo: null };
  try {
    const parsed = JSON.parse(rows[0].value) as { logo?: StoredLogo | null };
    return { logo: parsed.logo ?? null };
  } catch {
    return { logo: null };
  }
}

/** Roughly how many bytes a data URI or SVG string actually carries. */
function sizeOf(kind: "image" | "svg", data: string): number {
  if (kind === "svg") return Buffer.byteLength(data, "utf8");
  const base64 = data.slice(data.indexOf(",") + 1);
  return Math.floor((base64.length * 3) / 4);
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/settings/branding", { preHandler: canRead }, async () => ({
    branding: await loadBranding(),
  }));

  app.put("/api/v1/settings/branding", { preHandler: isAdmin }, async (request) => {
    requireAuth(request);
    const { logo } = logoBody.parse(request.body);
    const before = await loadBranding();

    if (logo) {
      if (logo.kind === "image" && !/^data:image\/(png|jpeg);base64,/.test(logo.data)) {
        throw badRequest("The logo must be a PNG or JPEG image, or an SVG file.");
      }
      const bytes = sizeOf(logo.kind, logo.data);
      if (bytes > MAX_BYTES) {
        throw badRequest(`That file is ${Math.round(bytes / 1024)} KB. The limit is 512 KB.`);
      }

      /**
       * Render a throwaway PDF containing the logo before saving it. A file
       * the PDF engine cannot draw would otherwise break every report from
       * then on, and the person who finds out would be whoever next tried to
       * export — not the person who uploaded it.
       */
      const ok = await probeLogo(logo.kind, logo.data);
      if (!ok) {
        throw badRequest(
          "That file could not be drawn into a PDF. Try a PNG export of the same logo.",
        );
      }

      const stored: StoredLogo = { ...logo, bytes };
      await query(
        `insert into settings (key, value) values ('branding', $1)
         on conflict (key) do update set value = excluded.value,
                                         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        [JSON.stringify({ logo: stored })],
      );
      await audit(request, {
        action: "Report logo set",
        entity: "settings",
        entityId: "branding",
        before: { logo: before.logo?.filename ?? null },
        after: { logo: stored.filename, kind: stored.kind, bytes },
      });
      return { branding: { logo: stored } };
    }

    await query("delete from settings where key = 'branding'");
    await audit(request, {
      action: "Report logo removed",
      entity: "settings",
      entityId: "branding",
      before: { logo: before.logo?.filename ?? null },
    });
    return { branding: { logo: null } };
  });

  // —— outgoing email ————————————————————
  // Administrators only. These settings name an internal mail server and an
  // account on it — infrastructure detail a read-only auditor has no reason
  // to see, and the sort of thing that turns a low-privilege account into a
  // useful one for anybody who gets it.

  app.get("/api/v1/settings/smtp", { preHandler: isAdmin }, async () => ({
    smtp: toSafe(await loadSmtp()),
  }));

  app.put("/api/v1/settings/smtp", { preHandler: isAdmin }, async (request) => {
    requireAuth(request);
    const body = smtpBody.parse(request.body);
    const before = await loadSmtp();

    const settings: SmtpSettings = applyProvider({
      provider: body.provider as MailProvider,
      enabled: body.enabled,
      host: body.host.trim(),
      port: body.port,
      secure: body.secure,
      username: body.username.trim(),
      // A secret for one provider is meaningless to another, and silently
      // offering a mail password to Resend as an API key would fail in a way
      // nobody could read. Changing provider without supplying a new secret
      // therefore clears the old one.
      passwordEnc:
        before.provider !== body.provider && body.password === undefined
          ? ""
          : nextPassword(before.passwordEnc, body.password),
      fromAddress: body.fromAddress.trim(),
      fromName: body.fromName.trim(),
      rejectUnauthorized: body.rejectUnauthorized,
    });

    // Turning it on with something missing would mean every later send
    // failing quietly. Refuse now, while somebody is looking at the screen.
    if (settings.enabled) {
      const blocked = whyNotSendable(settings);
      if (blocked) throw badRequest(`Email cannot be turned on yet: ${blocked}`);
    }

    await saveSmtp(settings);
    await audit(request, {
      action: settings.enabled ? "Email settings saved" : "Email turned off",
      entity: "settings",
      entityId: "smtp",
      before: smtpAuditView(before),
      after: smtpAuditView(settings),
    });
    return { smtp: toSafe(settings) };
  });

  /**
   * Proves the settings work, by connecting and then sending.
   *
   * Uses what is saved, so the button means "does this actually work"
   * rather than "would this work if I saved it". `enabled` is ignored: the
   * sensible order is to test first and turn it on once it works.
   *
   * Verifying before sending separates "the server refused your password"
   * from "that recipient does not exist", which are different problems with
   * different fixes.
   */
  app.post("/api/v1/settings/smtp/test", { preHandler: isAdmin }, async (request) => {
    requireAuth(request);
    const { to } = smtpTestBody.parse(request.body);
    const settings = { ...(await loadSmtp()), enabled: true };

    const reachable = await verifySmtp(settings);
    if (!reachable.sent) {
      await audit(request, {
        action: "Email test failed",
        entity: "settings",
        entityId: "smtp",
        after: { stage: "connect", reason: reachable.reason },
      });
      return { ok: false, stage: "connect", reason: reachable.reason };
    }

    const sent = await sendMail(
      {
        to,
        subject: `${product.name} — Test Message`,
        text:
          `This is a test from ${product.name}.\n\n` +
          "If you are reading it, the mail settings work and the product can " +
          "send you notifications.\n\n" +
          `Sent by ${request.user?.name ?? "an administrator"} at ` +
          `${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC.\n`,
      },
      settings,
    );

    await audit(request, {
      action: sent.sent ? "Email test sent" : "Email test failed",
      entity: "settings",
      entityId: "smtp",
      after: { stage: "send", to, reason: sent.reason },
    });

    return sent.sent
      ? { ok: true, to }
      : { ok: false, stage: "send", reason: sent.reason };
  });

  // —— the daily digest ——————————————————

  app.get("/api/v1/settings/digest", { preHandler: isAdmin }, async () => ({
    digest: await loadDigest(),
  }));

  app.put("/api/v1/settings/digest", { preHandler: isAdmin }, async (request) => {
    requireAuth(request);
    const body = digestBody.parse(request.body);
    const before = await loadDigest();
    const settings: DigestSettings = {
      enabled: body.enabled,
      recipients: body.recipients.map((r) => r.trim()).filter(Boolean),
      sendWhenEmpty: body.sendWhenEmpty,
      horizonDays: body.horizonDays,
    };

    // Turning it on when nothing could ever be sent is the same mistake as
    // with the mail settings: it fails at 2am, quietly, once.
    if (settings.enabled) {
      const blocked = whyNotSendable(await loadSmtp());
      if (blocked) {
        throw badRequest(`The digest needs email working first: ${blocked.toLowerCase()}`);
      }
      if (!(await digestRecipients(settings)).length) {
        throw badRequest(
          "Nobody would receive it. Add an address, or give an administrator one.",
        );
      }
    }

    await saveDigest(settings);
    await audit(request, {
      action: settings.enabled ? "Digest enabled" : "Digest disabled",
      entity: "settings",
      entityId: "digest",
      before,
      after: settings,
    });
    return { digest: settings };
  });

  /**
   * What today's digest would say, without sending it.
   *
   * Worth having: the honest answer to "should I turn this on" is to read
   * one, and nobody wants to wait until tomorrow morning to find out it is
   * useless or enormous.
   */
  app.get("/api/v1/settings/digest/preview", { preHandler: isAdmin }, async () => {
    const settings = await loadDigest();
    const digest = await buildDigest(settings);
    return {
      subject: digest.subject,
      body: digest.body,
      actionable: digest.actionable,
      recipients: await digestRecipients(settings),
      wouldSend: digest.actionable > 0 || settings.sendWhenEmpty,
    };
  });

  /** Sends today's digest now, whatever the schedule says. */
  app.post("/api/v1/settings/digest/send", { preHandler: isAdmin }, async (request) => {
    requireAuth(request);
    const settings = await loadDigest();

    const blocked = whyNotSendable(await loadSmtp());
    if (blocked) return { ok: false, reason: blocked };

    const to = await digestRecipients(settings);
    if (!to.length) {
      return { ok: false, reason: "Nobody is set to receive it." };
    }

    const digest = await buildDigest(settings);
    const sent = await sendMail({ to, subject: digest.subject, text: digest.body });

    await audit(request, {
      action: sent.sent ? "Digest sent" : "Digest failed",
      entity: "settings",
      entityId: "digest",
      after: { to: to.length, actionable: digest.actionable, reason: sent.reason },
    });

    return sent.sent
      ? { ok: true, to, actionable: digest.actionable }
      : { ok: false, reason: sent.reason };
  });
}
