import { join, resolve } from "node:path";
import { query, db } from "../db/pool.js";
import { createBackup, pruneBackups } from "../backup/service.js";
import { purgeExpiredSessions } from "../auth/session.js";
import { config, MATURITY_DEFAULT_TARGET } from "../config.js";
import { todayIso } from "../lib/time.js";
import { sendReminders } from "../mail/escalation.js";
import { loadSmtp, sendMail, whyNotSendable } from "../mail/mailer.js";
import { buildDigest, digestRecipients, loadDigest } from "../mail/digest.js";

/**
 * What the worker actually does.
 *
 * Each handler returns a short line for the log — the operator's answer to
 * "did the backup run last night?" — and is safe to run twice, because a
 * retry after a partial failure must not do damage.
 *
 * Deliberately not here:
 *
 *  - Evidence freshness. It is computed in SQL when read, from the collected
 *    date, so there is nothing to recompute. A job would only pretend to work.
 */

export interface JobResult {
  summary: string;
}

export type Handler = () => Promise<JobResult>;

/**
 * Today's readiness, written to `trend`.
 *
 * The one thing nothing else writes: every other number in the product is
 * computed live, so without this there is no history and no way to show whether
 * a programme is getting better or worse.
 *
 * Keyed by day and upserted, so running twice in a day corrects the figure
 * rather than duplicating it.
 */
export const readinessSnapshot: Handler = async () => {
  /**
   * Two frameworks, two meanings of "ready".
   *
   * Where controls are ticked, readiness is the share implemented. Where they
   * are scored, it is the share at or above target — SAMA's own question. The
   * trend table holds one percentage either way, so the chart stays comparable
   * with itself over time even though the question behind it differs by
   * product.
   *
   * Which one applies is decided by the data, not by a setting: if anything has
   * been scored, this is a maturity programme.
   */
  const maturity = await query<{ scored: number; at_target: number }>(
    `select count(maturity) as scored,
            sum(case when maturity is not null
                      and maturity >= coalesce(target_maturity, $1)
                     then 1 else 0 end) as at_target
       from controls
      where status <> 'not_applicable'`,
    [MATURITY_DEFAULT_TARGET],
  );
  const scored = maturity.rows[0]?.scored ?? 0;

  let applicable: number;
  let implemented: number;
  if (scored > 0) {
    applicable = scored;
    implemented = maturity.rows[0]?.at_target ?? 0;
  } else {
    const { rows } = await query<{ applicable: number; implemented: number }>(
      `select
         sum(case when status <> 'not_applicable' then 1 else 0 end) as applicable,
         sum(case when status = 'implemented' then 1 else 0 end) as implemented
       from controls`,
    );
    applicable = rows[0]?.applicable ?? 0;
    implemented = rows[0]?.implemented ?? 0;
  }
  const pct = applicable > 0 ? Math.round((implemented / applicable) * 100) : 0;

  await query(
    `insert into trend (day, pct) values ($1, $2)
     on conflict (day) do update set pct = excluded.pct`,
    [todayIso(), pct],
  );
  return { summary: `readiness ${pct}% (${implemented} of ${applicable}) recorded for ${todayIso()}` };
};

/** Expired sessions are dead weight and a small liability. */
export const sessionPurge: Handler = async () => {
  const removed = await purgeExpiredSessions();
  return { summary: `${removed} expired session(s) removed` };
};

/**
 * Trims finished job rows so the queue table does not grow without limit.
 * Failed rows are kept longer — those are the ones someone needs to read.
 */
export const jobLogPurge: Handler = async () => {
  const done = await query("delete from jobs where completed_at < date('now','-14 days')");
  const failed = await query("delete from jobs where failed_at < date('now','-90 days')");
  return { summary: `${done.rowCount} completed and ${failed.rowCount} failed job row(s) removed` };
};

/**
 * Audit retention. Off unless the operator sets a number of days, because an
 * audit trail is evidence and deleting it is their decision, not a default.
 */
export const auditPurge: Handler = async () => {
  const days = config.AUDIT_RETENTION_DAYS;
  if (days === 0) return { summary: "audit retention is off; nothing removed" };

  const { rowCount } = await query(`delete from audit_log where ts < date('now','-${days} days')`);
  return { summary: `${rowCount} audit row(s) older than ${days} days removed` };
};

/**
 * Folds the write-ahead log back into the database.
 *
 * The benchmark in ADR 0002 showed the automatic checkpoint is what puts about
 * 15 ms into the write tail — whichever unlucky request trips the threshold
 * pays for it. Doing it here on a schedule takes that off the user's request
 * path. TRUNCATE also stops the -wal file growing without bound.
 */
export const walCheckpoint: Handler = async () => {
  const result = db.pragma("wal_checkpoint(TRUNCATE)") as
    | { busy: number; log: number; checkpointed: number }[]
    | undefined;
  const row = result?.[0];
  if (row?.busy === 1) {
    return { summary: "checkpoint skipped: a writer held the database" };
  }
  return { summary: `checkpoint moved ${row?.checkpointed ?? 0} page(s) into the database` };
};

/**
 * Nightly backup, using SQLite's online backup API, so it is safe while people
 * are working. Old backups are pruned afterwards — a backup job that fills the
 * disk takes the system down more reliably than the thing it protects against.
 */
export const backup: Handler = async () => {
  if (!config.BACKUP_ENABLED) return { summary: "backups are disabled" };

  const dir = resolve(config.BACKUP_DIR);
  // The database and every evidence document, in one file, the same as a
  // backup taken from the Backups screen. It used to be the database alone,
  // which restored every evidence record pointing at files that were gone.
  const taken = await createBackup("nightly");
  const file = join(dir, taken.name);

  // Keep the newest BACKUP_KEEP backups of every kind; delete the rest.
  const stale = await pruneBackups([taken.name]);

  return {
    summary:
      `backup written to ${file}` +
      (stale.length ? `, ${stale.length} old backup(s) removed` : ""),
  };
};

/** Everything the worker knows how to run. */
/**
 * The daily digest.
 *
 * Four ways this does nothing, and all of them are normal: the digest is off,
 * email is not configured, there is nothing needing attention, or nobody is
 * listed to receive it. Each returns a summary saying which, because "the
 * digest did not arrive" is a question somebody will ask and the log should
 * already answer it.
 *
 * A send that actually fails throws, so the queue retries with its widening
 * delay and leaves a failed row an operator can see. A mail server that is
 * briefly down should not cost a day's digest.
 */
export const emailDigest: Handler = async () => {
  const settings = await loadDigest();
  if (!settings.enabled) return { summary: "digest is off" };

  const blocked = whyNotSendable(await loadSmtp());
  if (blocked) return { summary: `digest not sent: ${blocked.toLowerCase()}` };

  const digest = await buildDigest(settings);
  if (digest.actionable === 0 && !settings.sendWhenEmpty) {
    return { summary: "nothing needs attention; no digest sent" };
  }

  const to = await digestRecipients(settings);
  if (!to.length) return { summary: "digest has nobody to send to" };

  const result = await sendMail({ to, subject: digest.subject, text: digest.body });
  if (!result.sent) throw new Error(`digest could not be sent: ${result.reason}`);

  return {
    summary: `digest sent to ${to.length} recipient(s), ${digest.actionable} item(s)`,
  };
};

/**
 * Chases the people who own something that is due.
 *
 * Controls, tasks and readiness-plan steps alike, on three days only: three
 * days before the date, on the date, and every day after it while the thing is
 * still outstanding. A daily drip from the moment something is created teaches
 * people to filter the sender, and then the one that mattered goes unread too.
 *
 * One email each, about their own controls only. It sends nothing at all until
 * somebody has put both an address and a date on a control, which is the
 * customer explicitly asking to be chased - a product that starts emailing
 * people on its own is a product that gets switched off.
 *
 * A failure to send one person's reminder does not stop the rest. The job
 * reports what got through and what did not rather than throwing on the first
 * bad address, because one typo should not silence everybody else's reminder.
 */
export const controlReminders: Handler = async () => {
  const out = await sendReminders(todayIso());
  if (out.blocked) return { summary: `reminders not sent: ${out.blocked.toLowerCase().replace(/\.$/, "")}` };

  const sent = out.owner + out.chain;
  if (!sent && !out.failed) return { summary: "nothing due today; no reminders sent" };

  const summary =
    `${out.owner} reminder(s) sent to owners, ${out.chain} up the chain` +
    (out.failed ? `; ${out.failed} failed: ${out.reasons.slice(0, 5).join(", ")}` : "");

  // Every address failing is a configuration problem, not a bad address, and
  // should show up as a failed job rather than a quiet line in the log.
  if (sent === 0 && out.failed) throw new Error(summary);
  return { summary };
};

export const HANDLERS: Record<string, Handler> = {
  "readiness-snapshot": readinessSnapshot,
  "session-purge": sessionPurge,
  "job-log-purge": jobLogPurge,
  "audit-purge": auditPurge,
  "wal-checkpoint": walCheckpoint,
  "email-digest": emailDigest,
  "control-reminders": controlReminders,
  backup,
};

/**
 * Recurring work, and how often. `daily` runs at DAILY_JOB_HOUR; the others
 * run on a plain interval.
 */
export const SCHEDULE: { name: string; daily?: boolean; everyMinutes?: number }[] = [
  { name: "readiness-snapshot", daily: true },
  { name: "backup", daily: true },
  // After the snapshot, so the readiness figure it quotes is today's.
  { name: "email-digest", daily: true },
  // Same daily slot as the digest: the digest tells administrators where the
  // programme stands, this tells one person what they personally owe.
  { name: "control-reminders", daily: true },
  { name: "audit-purge", daily: true },
  { name: "job-log-purge", daily: true },
  { name: "session-purge", everyMinutes: 60 },
  { name: "wal-checkpoint", everyMinutes: 30 },
];
