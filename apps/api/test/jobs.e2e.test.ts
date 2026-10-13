import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rm, mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../src/config.js";
import { pruneBackups } from "../src/backup/service.js";
import { migrate } from "../src/db/migrate.js";
import { seedControls } from "../src/db/seed.js";
import { pool, query } from "../src/db/pool.js";
import {
  enqueue, enqueueUnique, claimNext, complete, fail, releaseStale, nextDailyRun, MAX_ATTEMPTS,
} from "../src/jobs/queue.js";
import {
  readinessSnapshot, sessionPurge, jobLogPurge, walCheckpoint, backup, HANDLERS, SCHEDULE,
} from "../src/jobs/handlers.js";

/**
 * The queue and the jobs. The claiming test is the one that matters: the API
 * and the worker are separate processes on one database file, so two claims of
 * the same row must not both succeed.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

maybe("background jobs", () => {
  beforeAll(async () => {
    await migrate();
    for (const t of ["jobs", "trend", "sessions", "audit_log", "users", "controls"]) {
      await query(`delete from ${t}`);
    }
    await seedControls();
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  it("claims a due job exactly once, even from two callers at the same moment", async () => {
    await query("delete from jobs");
    await enqueue("wal-checkpoint", new Date(Date.now() - 1000));

    // Both race for the single queued row.
    const [a, b] = await Promise.all([claimNext(), claimNext()]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.attempts).toBe(1);

    // And nothing is left for a third caller.
    expect(await claimNext()).toBeNull();
  });

  it("does not run a job before it is due", async () => {
    await query("delete from jobs");
    await enqueue("wal-checkpoint", new Date(Date.now() + 60 * 60_000));
    expect(await claimNext()).toBeNull();
  });

  it("keeps recurring work from piling up while the worker is down", async () => {
    await query("delete from jobs");
    const first = await enqueueUnique("backup", new Date(Date.now() + 3600_000));
    const second = await enqueueUnique("backup", new Date(Date.now() + 3600_000));
    expect(first).toBe(true);
    expect(second).toBe(false);

    const { rows } = await query<{ n: number }>("select count(*) as n from jobs where name = 'backup'");
    expect(rows[0]!.n).toBe(1);
  });

  it("retries with a widening delay, then gives up", async () => {
    await query("delete from jobs");
    await enqueue("wal-checkpoint", new Date(Date.now() - 1000));

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      const job = await claimNext();
      expect(job, `attempt ${attempt}`).not.toBeNull();
      await fail(job!, new Error("nope"));

      const { rows } = await query<{ run_after: string; started_at: string | null }>(
        "select run_after, started_at from jobs limit 1",
      );
      // Freed for another go, but pushed into the future.
      expect(rows[0]!.started_at).toBeNull();
      expect(new Date(rows[0]!.run_after).getTime()).toBeGreaterThan(Date.now());
      await query("update jobs set run_after = $1", [new Date(Date.now() - 1000).toISOString()]);
    }

    const last = await claimNext();
    await fail(last!, new Error("nope"));
    const { rows } = await query<{ failed_at: string | null; last_error: string }>(
      "select failed_at, last_error from jobs limit 1",
    );
    expect(rows[0]!.failed_at).not.toBeNull();
    expect(rows[0]!.last_error).toBe("nope");
    expect(await claimNext()).toBeNull();
  });

  it("frees a job stranded by a worker that died mid-run", async () => {
    await query("delete from jobs");
    await enqueue("wal-checkpoint", new Date(Date.now() - 1000));
    const job = await claimNext();
    expect(job).not.toBeNull();

    // Nothing to free yet — it has only just been claimed.
    expect(await releaseStale(30)).toBe(0);

    // Pretend the claim happened an hour ago and the worker never came back.
    await query("update jobs set started_at = $1 where id = $2", [
      new Date(Date.now() - 60 * 60_000).toISOString(),
      job!.id,
    ]);
    expect(await releaseStale(30)).toBe(1);
    expect(await claimNext()).not.toBeNull();
  });

  it("records readiness for today, and corrects it rather than duplicating", async () => {
    await query("delete from trend");
    const first = await readinessSnapshot();
    expect(first.summary).toMatch(/readiness \d+%/);

    const { rows } = await query<{ day: string; pct: number }>("select * from trend");
    expect(rows).toHaveLength(1);

    // Change the data, run again the same day: one row, updated.
    const { rows: some } = await query<{ id: string }>("select id from controls limit 20");
    for (const c of some) await query("update controls set status = 'implemented' where id = $1", [c.id]);

    const second = await readinessSnapshot();
    const after = await query<{ day: string; pct: number }>("select * from trend");
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]!.pct).toBeGreaterThan(rows[0]!.pct);
    expect(second.summary).toContain("recorded for");
  });

  it("checkpoints the write-ahead log", async () => {
    const result = await walCheckpoint();
    expect(result.summary).toMatch(/checkpoint/);
  });

  it("removes only expired sessions", async () => {
    await query("delete from sessions");
    await query("delete from users");
    const { randomUUID } = await import("node:crypto");
    const userId = randomUUID();
    await query(
      `insert into users (id,username,name,email,role,auth_source,password_hash)
       values ($1,'jobs','Jobs','jobs@example.test','admin','local','x')`,
      [userId],
    );
    for (const [id, expires] of [
      ["expired", new Date(Date.now() - 3600_000).toISOString()],
      ["live", new Date(Date.now() + 3600_000).toISOString()],
    ]) {
      await query(
        "insert into sessions (sid, user_id, expires_at) values ($1, $2, $3)",
        [id, userId, expires],
      );
    }
    const result = await sessionPurge();
    expect(result.summary).toBe("1 expired session(s) removed");

    const { rows } = await query<{ sid: string }>("select sid from sessions");
    expect(rows.map((r) => r.sid)).toEqual(["live"]);
  });

  it("writes a backup and keeps only the newest few, of every kind", async () => {
    const dir = resolve(process.cwd(), "./backups");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    // Older backups of every kind, each a day apart by file time, which is
    // what the prune reads. The one uploaded most recently carries the oldest
    // name, as a restored-from-archive file would.
    const older = [
      "offset-2020-01-01.db", "manual-2020-01-02.db", "pre-update-0.1.0-2020-01-03.db",
      "pre-restore-2020-01-04.db", "offset-2020-01-05.db", "uploaded-2019-01-01.db",
    ];
    for (const [i, name] of older.entries()) {
      const path = resolve(dir, name);
      await writeFile(path, "old");
      const at = new Date(Date.UTC(2020, 0, 1 + i));
      await utimes(path, at, at);
    }
    await writeFile(resolve(dir, "offset-2020-01-01.db-shm"), "sqlite leftovers");
    // A file that is not a backup must survive the prune.
    await writeFile(resolve(dir, "notes.txt"), "keep me");

    const result = await backup();
    expect(result.summary).toContain("backup written");

    const left = await readdir(dir);
    const backups = left.filter((f) => /^(offset|manual|pre-restore|pre-update|uploaded)-.*\.db$/.test(f));
    expect(backups).toHaveLength(config.BACKUP_KEEP);
    // The fresh one, then the newest by file time: the upload, then the nightly before it.
    expect(backups.filter((f) => !older.includes(f))).toHaveLength(1);
    expect(backups).toContain("uploaded-2019-01-01.db");
    expect(backups).toContain("offset-2020-01-05.db");
    // Every other kind went, with SQLite's leftovers.
    expect(left).not.toContain("manual-2020-01-02.db");
    expect(left).not.toContain("pre-update-0.1.0-2020-01-03.db");
    expect(left).not.toContain("offset-2020-01-01.db-shm");
    expect(left).toContain("notes.txt");

    await rm(dir, { recursive: true, force: true });
  });

  it("never prunes a backup it is told to protect", async () => {
    const dir = resolve(process.cwd(), "./backups");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < 6; i++) {
      const path = resolve(dir, `offset-2020-02-0${i + 1}.db`);
      await writeFile(path, "old");
      const at = new Date(Date.UTC(2020, 1, 1 + i));
      await utimes(path, at, at);
    }

    const removed = await pruneBackups(["offset-2020-02-01.db"]);
    const left = (await readdir(dir)).sort();
    expect(left).toContain("offset-2020-02-01.db");
    expect(left).toHaveLength(config.BACKUP_KEEP + 1);
    expect(removed).not.toContain("offset-2020-02-01.db");

    await rm(dir, { recursive: true, force: true });
  });

  it("trims finished job rows but keeps recent ones", async () => {
    await query("delete from jobs");
    await enqueue("wal-checkpoint");
    await query("update jobs set completed_at = date('now','-30 days')");
    await enqueue("wal-checkpoint");
    await query("update jobs set completed_at = date('now') where completed_at is null");

    const result = await jobLogPurge();
    expect(result.summary).toMatch(/1 completed/);
    const { rows } = await query<{ n: number }>("select count(*) as n from jobs");
    expect(rows[0]!.n).toBe(1);
  });

  it("has a handler for every scheduled job", () => {
    for (const entry of SCHEDULE) {
      expect(HANDLERS[entry.name], entry.name).toBeTypeOf("function");
    }
  });

  it("always schedules the next daily run in the future", () => {
    const midnight = new Date("2026-09-10T00:00:00");
    expect(nextDailyRun(2, midnight).getHours()).toBe(2);
    expect(nextDailyRun(2, midnight).getTime()).toBeGreaterThan(midnight.getTime());

    // Already past today's hour: it must roll to tomorrow, not schedule the past.
    const evening = new Date("2026-09-10T23:00:00");
    const next = nextDailyRun(2, evening);
    expect(next.getTime()).toBeGreaterThan(evening.getTime());
    expect(next.getDate()).toBe(11);
  });
});
