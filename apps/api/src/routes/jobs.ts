import type { FastifyInstance } from "fastify";
import { query } from "../db/pool.js";
import { canRead, isAdmin } from "../auth/rbac.js";
import { SCHEDULE } from "../jobs/handlers.js";

/**
 * Job status, and the readiness history the snapshot job builds.
 *
 * "Did last night's backup run?" is an operations question an on-premise
 * customer has to be able to answer without reading the container logs.
 */

interface JobRow {
  name: string;
  run_after: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  attempts: number;
  last_error: string | null;
}

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/jobs", { preHandler: isAdmin }, async () => {
    const { rows } = await query<JobRow>(
      `select name, run_after, started_at, completed_at, failed_at, attempts, last_error
         from jobs
        order by coalesce(completed_at, failed_at, started_at, run_after) desc
        limit 100`,
    );

    // One line per recurring job: when it last succeeded, and when it is next due.
    const summary = SCHEDULE.map((entry) => {
      const mine = rows.filter((r) => r.name === entry.name);
      const lastOk = mine.find((r) => r.completed_at)?.completed_at ?? null;
      const lastFail = mine.find((r) => r.failed_at);
      const pending = mine.find((r) => !r.completed_at && !r.failed_at);
      return {
        name: entry.name,
        cadence: entry.daily ? "daily" : `every ${entry.everyMinutes} min`,
        lastSucceeded: lastOk,
        lastError: lastFail?.last_error ?? null,
        nextDue: pending?.run_after ?? null,
      };
    });

    return { jobs: summary, recent: rows.slice(0, 40) };
  });

  /** Readiness over time — the only history the product keeps. */
  app.get("/api/v1/trend", { preHandler: canRead }, async () => {
    const { rows } = await query<{ day: string; pct: number }>(
      "select day, pct from trend order by day desc limit 180",
    );
    return { trend: rows.reverse() };
  });
}
