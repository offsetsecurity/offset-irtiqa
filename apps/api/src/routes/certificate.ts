import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAdmin, requireAuth } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { badRequest } from "../lib/errors.js";
import { config, isLoopbackHost, product } from "../config.js";
import {
  CertificateError, describe, hasUpload, loadTls, prepareUpload, removeUpload, saveUpload,
  settingsFilesConfigured, uploadDetails, warningsFor, type CertificateInfo,
} from "../tls/certificate.js";
import { applyLive, servingHttps } from "../tls/server.js";

/**
 * Settings → HTTPS certificate.
 *
 * Administrators only. Upload the certificate the company's IT team issued
 * and the browser stops saying "Not secure" - without anybody editing the
 * settings file or knowing where it lives.
 *
 * On a server already serving HTTPS the new certificate is in use the moment
 * it is saved. On one still on plain HTTP it takes a restart, because the
 * listening socket itself has to change; the screen says so and says how.
 */

const MAX_FILE_BYTES = 64 * 1024;

const uploadBody = z
  .object({
    files: z
      .array(
        z.object({
          name: z.string().max(200),
          data: z.string().min(1).max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 4, "That file is too big to be a certificate."),
        }),
      )
      .min(1, "Choose the certificate file first.")
      .max(4, "Choose at most four files: the certificate, its key, and the chain."),
    /** For a .pfx file, or a private key that has a password. Never stored in clear. */
    password: z.string().max(1024).default(""),
    /** Save it even though there are warnings, having been shown them. */
    confirm: z.boolean().default(false),
  })
  .strict();

function publicHost(): string {
  try {
    return new URL(config.PUBLIC_URL).hostname;
  } catch {
    return "";
  }
}

/** For the audit trail: enough to tell certificates apart, nothing secret. */
function auditView(info: CertificateInfo | null): Record<string, unknown> | null {
  return info && { subject: info.subject, issuer: info.issuer, validTo: info.validTo, fingerprint: info.fingerprint };
}

function current(): { source: "uploaded" | "settings" | "none"; certificate: CertificateInfo | null; problem: string | null } {
  try {
    const tls = loadTls();
    if (!tls) return { source: "none", certificate: null, problem: null };
    return { source: tls.source, certificate: describe(tls.options), problem: null };
  } catch (err) {
    return {
      source: hasUpload() ? "uploaded" : "settings",
      certificate: null,
      problem: err instanceof CertificateError ? err.message : `It cannot be used: ${(err as Error).message}`,
    };
  }
}

/** Why removing the uploaded certificate would leave a server that will not start, if it would. */
function removeBlocked(): string | null {
  if (isLoopbackHost(config.HOST) || config.ALLOW_INSECURE_NETWORK || settingsFilesConfigured()) return null;
  return (
    "This server answers other computers, and without a certificate it refuses to start. " +
    "Upload a replacement instead."
  );
}

/** How to restart this install, in the words for how it was installed. */
function restartHow(): string {
  switch (config.INSTALL_KIND) {
    case "docker":
      return "In the product's folder on the server, run: docker compose restart app";
    case "linux":
      return `On the server, run: sudo systemctl restart offset-${config.PRODUCT}`;
    case "windows":
      return (
        "Restart the server. Or, in PowerShell run as administrator: " +
        `Stop-ScheduledTask -TaskName "${product.name}"; Start-ScheduledTask -TaskName "${product.name}". ` +
        "If it runs in a window instead, close the window and start it again."
      );
    default:
      return "Stop the application and start it again.";
  }
}

export function certificateStatus() {
  const now = current();
  const serving = servingHttps() ? "https" : "http";
  const configured = now.source !== "none" && !now.problem;
  return {
    serving,
    source: now.source,
    certificate: now.certificate,
    problem: now.problem,
    warnings: now.certificate ? warningsFor(now.certificate, publicHost()) : [],
    upload: uploadDetails(),
    /** The certificate on disk is not what this process is serving, or vice versa. */
    restartNeeded: configured !== (serving === "https"),
    installKind: config.INSTALL_KIND,
    /** Only this computer can open it: HOST is a loopback address. Not meaningful in Docker. */
    localOnly: config.INSTALL_KIND !== "docker" && isLoopbackHost(config.HOST),
    restartHow: restartHow(),
    publicUrl: config.PUBLIC_URL,
    removeBlocked: now.source === "uploaded" ? removeBlocked() : null,
  };
}

export async function certificateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/settings/certificate", { preHandler: isAdmin }, async () => certificateStatus());

  app.put("/api/v1/settings/certificate", { preHandler: isAdmin }, async (request) => {
    requireAuth(request);
    const body = uploadBody.parse(request.body);

    let prepared: ReturnType<typeof prepareUpload>;
    try {
      prepared = prepareUpload(body.files, body.password);
    } catch (err) {
      if (err instanceof CertificateError) throw badRequest(err.message);
      throw err;
    }

    // Shown before anything changes, so a certificate for the wrong name
    // cannot replace a working one by accident.
    const warnings = warningsFor(prepared.info, publicHost());
    if (warnings.length && !body.confirm) {
      return { needsConfirmation: true, certificate: prepared.info, warnings };
    }

    const before = current().certificate;
    saveUpload(prepared.options, body.files.map((f) => f.name));
    const appliedNow = applyLive(prepared.options);

    await audit(request, {
      action: "HTTPS certificate uploaded",
      entity: "settings",
      entityId: "certificate",
      before: auditView(before),
      after: { ...auditView(prepared.info), appliedNow },
    });
    return { needsConfirmation: false, appliedNow, status: certificateStatus() };
  });

  app.delete("/api/v1/settings/certificate", { preHandler: isAdmin }, async (request) => {
    requireAuth(request);
    if (!hasUpload()) throw badRequest("No certificate has been uploaded here.");
    const blocked = removeBlocked();
    if (blocked) throw badRequest(blocked);

    const before = current().certificate;
    removeUpload();

    // Falling back to the files the settings name, if there are any, needs no
    // restart. Falling back to plain HTTP does.
    let appliedNow = false;
    try {
      const next = loadTls();
      if (next) appliedNow = applyLive(next.options);
    } catch {
      /* the status below reports the problem */
    }

    await audit(request, {
      action: "HTTPS certificate removed",
      entity: "settings",
      entityId: "certificate",
      before: auditView(before),
      after: { appliedNow },
    });
    return { appliedNow, status: certificateStatus() };
  });
}
