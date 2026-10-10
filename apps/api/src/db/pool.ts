import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "../config.js";

/**
 * SQLite, via better-sqlite3.
 *
 * The driver is synchronous, which is the right shape for an embedded database:
 * no pool, no connection juggling, no await on every row. The async `query()`
 * wrapper below exists so route code reads the same as it would against any
 * other database, and so a future swap does not touch every call site.
 *
 * Placeholders: routes are written with `$1, $2` numbering. SQLite wants
 * `?`. `toSqlite()` rewrites them and reorders the parameters, which also means
 * a query may reuse `$1` several times.
 */

function databaseFile(): string {
  // DATABASE_URL is either a bare path or file:./path
  const raw = config.DATABASE_URL.replace(/^file:/, "");
  return resolve(raw);
}

const file = databaseFile();

/** The database file this process has open. A restore writes into it. */
export const databasePath = file;
mkdirSync(dirname(file), { recursive: true });

export const db: SqliteDatabase = new Database(file);

// busy_timeout goes first, before any pragma that can block. Switching the
// journal mode takes a brief exclusive lock, and until the timeout is set a
// connection that finds the database busy gives up immediately rather than
// waiting. Defensive ordering rather than a fix for a reproduced failure — it
// costs nothing, and the API and worker do open this file at the same moment.
db.pragma("busy_timeout = 5000");
// WAL lets readers carry on while a write is in progress — the single biggest
// win for a multi-user app on SQLite.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
// Durable enough with WAL, and much faster than FULL.
db.pragma("synchronous = NORMAL");

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

const RETURNS_ROWS = /^\s*(select|with|pragma)\b/i;
const HAS_RETURNING = /\breturning\b/i;

/** `$1, $2 …` → `?`, with the parameter array reordered to match. */
export function toSqlite(sql: string, params: unknown[]): { text: string; values: unknown[] } {
  if (!params.length) return { text: sql, values: [] };
  const values: unknown[] = [];
  const text = sql.replace(/\$(\d+)/g, (_m, n: string) => {
    values.push(params[Number(n) - 1]);
    return "?";
  });
  return { text, values };
}

/** JSON and booleans need normalising on the way in; SQLite has neither type. */
function bind(values: unknown[]): unknown[] {
  return values.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "object") return JSON.stringify(v);
    return v;
  });
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const { text, values } = toSqlite(sql, params);
  const stmt = db.prepare(text);

  if (RETURNS_ROWS.test(text) || HAS_RETURNING.test(text)) {
    const rows = stmt.all(...bind(values)) as T[];
    return { rows, rowCount: rows.length };
  }

  const info = stmt.run(...bind(values));
  return { rows: [], rowCount: info.changes };
}

/** Kept for call sites that read like a pool. */
export const pool = {
  query,
  end: async (): Promise<void> => {
    db.close();
  },
};

export type Sql = { query: typeof query };

async function runTransaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = await fn({ query });
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}

/**
 * Serialises transactions within this process.
 *
 * One connection can hold one transaction. The callback is async, so it yields
 * at every await, and without this a second request arriving during that yield
 * would call BEGIN on a connection that already has one open — SQLite answers
 * "cannot start a transaction within a transaction", and that request fails
 * while the first carries on. Two people saving at the same moment is the
 * normal case for this product, not an edge case.
 *
 * Queuing costs nothing: a write here takes about 0.04 ms (see ADR 0002), so
 * the queue drains far faster than requests arrive. Contention between the API
 * and the worker is a different problem, handled by BEGIN IMMEDIATE and
 * busy_timeout, because those are separate processes.
 */
let tail: Promise<void> = Promise.resolve();

export function withTransaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  const result = tail.then(() => runTransaction(fn));
  // The queue has to survive a failed transaction, so the rejection is
  // swallowed here and re-thrown to the caller through `result`.
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function healthcheck(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = performance.now();
  db.prepare("select 1").get();
  return { ok: true, latencyMs: Math.round(performance.now() - started) };
}

/** Reclaims space and defragments. The worker runs this on a schedule. */
export function vacuum(): void {
  db.exec("VACUUM");
}

/**
 * Online backup to a single file — the whole point of choosing SQLite. Safe to
 * run while the application is serving traffic.
 */
export async function backupTo(destination: string): Promise<void> {
  mkdirSync(dirname(resolve(destination)), { recursive: true });
  await db.backup(resolve(destination));
}
