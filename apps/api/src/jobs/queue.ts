import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db/pool.js";
import { nowIso } from "../lib/time.js";

/**
 * The job queue.
 *
 * A table and a poller, not a broker — there is no Redis to operate on a
 * customer site, and at this size there does not need to be.
 *
 * Claiming is the only part that has to be exactly right. The API and the
 * worker are separate processes sharing one database file, and a worker can be
 * restarted mid-job, so a claim is a conditional update inside a write
 * transaction: whoever sets `started_at` first owns the job, and the loser sees
 * zero rows changed and moves on.
 */

export interface JobRow {
  id: string;
  name: string;
  payload: string;
  run_after: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  attempts: number;
  last_error: string | null;
}

export const MAX_ATTEMPTS = 3;

/** Adds a job to run at or after `runAfter`. */
export async function enqueue(
  name: string,
  runAfter: Date | string = new Date(),
  payload: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  await query(
    "insert into jobs (id, name, payload, run_after) values ($1, $2, $3, $4)",
    [id, name, JSON.stringify(payload), typeof runAfter === "string" ? runAfter : runAfter.toISOString()],
  );
  return id;
}

/**
 * Adds a job only if one of that name is already waiting or running.
 *
 * This is what keeps recurring work from piling up: a worker that was stopped
 * for a week must not come back to seven queued snapshots.
 */
export async function enqueueUnique(
  name: string,
  runAfter: Date | string,
  payload: Record<string, unknown> = {},
): Promise<boolean> {
  const when = typeof runAfter === "string" ? runAfter : runAfter.toISOString();
  return withTransaction(async (tx) => {
    const { rows } = await tx.query<{ n: number }>(
      "select count(*) as n from jobs where name = $1 and completed_at is null and failed_at is null",
      [name],
    );
    if ((rows[0]?.n ?? 0) > 0) return false;
    await tx.query("insert into jobs (id, name, payload, run_after) values ($1, $2, $3, $4)", [
      randomUUID(),
      name,
      JSON.stringify(payload),
      when,
    ]);
    return true;
  });
}

/**
 * Takes the next due job, or null. The claim and the check happen in one write
 * transaction, so two workers cannot both take the same row.
 */
export async function claimNext(): Promise<JobRow | null> {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query<JobRow>(
      `select * from jobs
        where completed_at is null and failed_at is null and started_at is null
          and run_after <= $1
        order by run_after
        limit 1`,
      [nowIso()],
    );
    const job = rows[0];
    if (!job) return null;

    const { rowCount } = await tx.query(
      "update jobs set started_at = $1, attempts = attempts + 1 where id = $2 and started_at is null",
      [nowIso(), job.id],
    );
    // Someone else got there first.
    return rowCount === 1 ? { ...job, attempts: job.attempts + 1 } : null;
  });
}

export async function complete(id: string): Promise<void> {
  await query("update jobs set completed_at = $1 where id = $2", [nowIso(), id]);
}

/**
 * Records a failure. Retries with a widening delay, and gives up after
 * MAX_ATTEMPTS so a job that can never succeed does not spin for ever.
 */
export async function fail(job: JobRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);

  if (job.attempts >= MAX_ATTEMPTS) {
    await query("update jobs set failed_at = $1, last_error = $2 where id = $3", [
      nowIso(),
      message.slice(0, 2000),
      job.id,
    ]);
    return;
  }

  const backoffMinutes = 5 * 2 ** (job.attempts - 1); // 5, 10, 20…
  const runAfter = new Date(Date.now() + backoffMinutes * 60_000).toISOString();
  await query(
    "update jobs set started_at = null, run_after = $1, last_error = $2 where id = $3",
    [runAfter, message.slice(0, 2000), job.id],
  );
}

/**
 * Frees jobs left claimed by a worker that died mid-run. Without this a crash
 * would strand a job as permanently "started" and it would never run again.
 */
export async function releaseStale(olderThanMinutes = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const { rowCount } = await query(
    `update jobs set started_at = null
      where started_at is not null and completed_at is null and failed_at is null
        and started_at < $1`,
    [cutoff],
  );
  return rowCount;
}

/** Has this job ever finished? Used to decide whether to run it immediately. */
export async function hasEverRun(name: string): Promise<boolean> {
  const { rows } = await query<{ n: number }>(
    "select count(*) as n from jobs where name = $1 and completed_at is not null",
    [name],
  );
  return (rows[0]?.n ?? 0) > 0;
}

/** The next occurrence of `hour` local time, always in the future. */
export function nextDailyRun(hour: number, from = new Date()): Date {
  const next = new Date(from);
  next.setHours(hour, 0, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  return next;
}
