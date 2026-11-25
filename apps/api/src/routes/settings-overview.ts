import type { FastifyInstance } from "fastify";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { query, databasePath } from "../db/pool.js";
import { isAdmin } from "../auth/rbac.js";
import { config } from "../config.js";
import { APP_VERSION } from "../version.js";
import { timeZone } from "../lib/time.js";
import { loadSmtp, MAIL_PROVIDERS } from "../mail/mailer.js";
import { loadDigest } from "../mail/digest.js";
import { listBackups } from "../backup/service.js";
import { loadTls } from "../tls/certificate.js";

/**
 * Settings → Overview: the state of every section and what changed lately,
 * and the facts about this server an auditor or an IT team asks for.
 *
 * Read only, and local only: nothing here contacts anything outside this
 * server. History comes from the audit trail, so it says only what was
 * recorded there.
 */

/** The audit actions that make up each section's recent history. */
const HISTORY: Record<string, string[]> = {
  updates: ["Update requested"],
  https: ["HTTPS certificate uploaded", "HTTPS certificate removed"],
  email: ["Email settings saved", "Email turned off", "Email test sent", "Email test failed"],
  digest: ["Digest enabled", "Digest disabled", "Digest sent", "Digest failed"],
  example: ["Example data loaded", "Example data removed"],
};

interface Event { action: string; actor: string; at: string }

async function lastEvents(actions: string[], limit = 2): Promise<Event[]> {
  const marks = actions.map((_, i) => `$${i + 1}`).join(", ");
  // The person's full name where the account still exists; the username
  // recorded at the time otherwise.
  const { rows } = await query<{ action: string; actor: string; ts: string }>(
    `select a.action, coalesce(nullif(u.name, ''), a.actor_name) as actor, a.ts
       from audit_log a left join users u on u.id = a.actor_id
      where a.action in (${marks}) order by a.ts desc limit ${limit}`,
    actions,
  );
  return rows.map((r) => ({ action: r.action, actor: r.actor, at: r.ts }));
}

async function lastAt(action: string): Promise<string | null> {
  const { rows } = await query<{ ts: string | null }>("select max(ts) as ts from audit_log where action = $1", [action]);
  return rows[0]?.ts ?? null;
}

const sizeOf = async (path: string): Promise<number> => (await stat(path).catch(() => null))?.size ?? 0;

/** Total size of the evidence folder. Stops counting after 50,000 files, so a huge folder cannot stall the page. */
async function folderSize(dir: string): Promise<{ bytes: number; files: number; partial: boolean }> {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const here = stack.pop()!;
    const entries = await readdir(here, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (files >= 50_000) return { bytes, files, partial: true };
      const p = join(here, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        bytes += await sizeOf(p);
        files += 1;
      }
    }
  }
  return { bytes, files, partial: false };
}

export async function settingsOverviewRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/settings/overview", { preHandler: isAdmin }, async () => {
    const [smtp, digest, backups, people, evidence] = await Promise.all([
      loadSmtp(),
      loadDigest(),
      listBackups().catch(() => []),
      query<{ role: string; n: number }>("select role, count(*) as n from users where disabled = 0 group by role"),
      folderSize(resolve(config.EVIDENCE_DIR)),
    ]);

    let https: { on: boolean; source: string } = { on: false, source: "none" };
    try {
      const tls = loadTls();
      https = { on: Boolean(tls), source: tls?.source ?? "none" };
    } catch {
      https = { on: false, source: "broken" };
    }

    const history: Record<string, Event[]> = {};
    for (const [area, actions] of Object.entries(HISTORY)) history[area] = await lastEvents(actions);

    return {
      server: {
        version: APP_VERSION,
        installKind: config.INSTALL_KIND,
        timeZone: timeZone(),
        uptimeSeconds: Math.round(process.uptime()),
        databaseBytes: (await sizeOf(databasePath)) + (await sizeOf(`${databasePath}-wal`)),
        evidence,
        backups: {
          enabled: config.BACKUP_ENABLED,
          keep: config.BACKUP_KEEP,
          count: backups.length,
          last: backups[0] ? { at: backups[0].createdAt, kind: backups[0].kind, bytes: backups[0].size } : null,
        },
        people: Object.fromEntries(people.rows.map((r) => [r.role, Number(r.n)])),
      },
      https,
      email: {
        enabled: smtp.enabled,
        provider: smtp.provider === "custom" ? (smtp.host ? smtp.host : null) : (MAIL_PROVIDERS[smtp.provider]?.label ?? smtp.provider),
        sender: smtp.fromAddress || null,
        lastTest: await lastEvents(["Email test sent", "Email test failed"], 1).then((e) => e[0] ?? null),
      },
      digest: {
        enabled: digest.enabled,
        recipients: digest.recipients.length,
        horizonDays: digest.horizonDays,
        lastSent: await lastAt("Digest sent"),
      },
      history,
    };
  });
}
