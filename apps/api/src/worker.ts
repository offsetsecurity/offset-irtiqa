import { config, product } from "./config.js";
import { pool, query } from "./db/pool.js";
import {
  buildLogger, captureCrashes, logStartupContext, recordCrash,
} from "./lib/logging.js";
import { HANDLERS, SCHEDULE } from "./jobs/handlers.js";
import {
  claimNext, complete, fail, enqueueUnique, releaseStale, nextDailyRun, hasEverRun,
} from "./jobs/queue.js";

/**
 * The background worker.
 *
 * A separate process from the API, so a long backup cannot slow a request, and
 * so the two can be restarted independently. It never migrates: the API owns
 * the schema, and a worker that raced it could apply migrations twice.
 */

let stopping = false;

const logger = buildLogger("worker");
captureCrashes(logger, "worker");

const log = (message: string, extra: Record<string, unknown> = {}): void => {
  logger.info(extra, message);
};

/** The API creates the schema. Wait rather than race it. */
async function waitForSchema(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await query("select 1 from jobs limit 1");
      return;
    } catch {
      if (attempt === 1) log("waiting for the database schema");
      if (stopping) return;
      await new Promise((r) => setTimeout(r, Math.min(attempt * 2000, 15_000)));
    }
  }
}

/**
 * Makes sure each recurring job has exactly one occurrence waiting.
 *
 * A job that has never completed runs now rather than at its next slot, so a
 * fresh install has a readiness figure and a backup within a minute instead of
 * looking empty until two in the morning.
 */
async function scheduleRecurring(): Promise<void> {
  for (const entry of SCHEDULE) {
    const when = (await hasEverRun(entry.name))
      ? entry.daily
        ? nextDailyRun(config.DAILY_JOB_HOUR)
        : new Date(Date.now() + (entry.everyMinutes ?? 60) * 60_000)
      : new Date();
    await enqueueUnique(entry.name, when);
  }
}

/**
 * One line saying what is queued and when. An idle worker logs nothing, so
 * without this an operator has no way to tell it is alive and waiting rather
 * than wedged — which is exactly the question they ask at 9am after a
 * backup was supposed to run at 2.
 */
async function reportSchedule(): Promise<void> {
  const { rows } = await query<{ name: string; run_after: string }>(
    `select name, run_after from jobs
      where completed_at is null and failed_at is null
      order by run_after`,
  );
  log("schedule", {
    next: rows.map((r) => `${r.name} @ ${r.run_after.slice(0, 16).replace("T", " ")}Z`),
  });
}

async function runOne(): Promise<boolean> {
  const job = await claimNext();
  if (!job) return false;

  const handler = HANDLERS[job.name];
  if (!handler) {
    await fail(job, `No handler named "${job.name}".`);
    log("job has no handler", { job: job.name });
    return true;
  }

  const started = Date.now();
  try {
    const { summary } = await handler();
    await complete(job.id);
    log("job done", { job: job.name, ms: Date.now() - started, summary });
  } catch (err) {
    await fail(job, err);
    log("job failed", {
      job: job.name,
      attempt: job.attempts,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

async function main(): Promise<void> {
  log("worker starting", { product: product.name, pollSeconds: config.WORKER_POLL_SECONDS });
  logStartupContext(logger, { product: product.name });
  await waitForSchema();
  if (stopping) return;

  // A worker that died mid-job would otherwise leave it claimed for ever.
  const freed = await releaseStale();
  if (freed) log("released stranded jobs", { count: freed });

  await scheduleRecurring();
  await reportSchedule();

  while (!stopping) {
    try {
      // Drain everything that is due before sleeping, so a backlog after a
      // restart clears in one pass rather than one job per poll.
      let worked = true;
      let didWork = false;
      while (worked && !stopping) {
        worked = await runOne();
        if (worked) didWork = true;
      }

      if (didWork) {
        await scheduleRecurring();
        await reportSchedule();
      }
    } catch (err) {
      // The loop itself must never die; a database blip is not fatal.
      log("worker loop error", { error: err instanceof Error ? err.message : String(err) });
    }

    for (let i = 0; i < config.WORKER_POLL_SECONDS && !stopping; i++) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  log("worker stopped");
  await pool.end();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(0);
    log("shutting down", { signal });
    stopping = true;
  });
}

main().catch((err: unknown) => {
  recordCrash("worker", "workerCrashed", err, logger);
  log("worker crashed", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
