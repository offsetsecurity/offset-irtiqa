import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { db, pool, query } from "./pool.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "migrations");

function ensureLedger(): void {
  db.exec(`
    create table if not exists schema_migrations (
      name       text primary key,
      sha256     text not null,
      applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `);
}

/** How many copies made before an upgrade are kept; older ones are removed. */
export const UPGRADE_COPIES_KEPT = 3;

/**
 * Before the server applies any change to an existing database, copy the
 * database so an upgrade can be undone: going back means restoring this copy
 * onto the old version, because migrations only go forward (F-U1). Does
 * nothing on a new database or when there is nothing to apply. Returns the
 * copy's path.
 *
 * `vacuum into` makes a consistent copy while the file is open in WAL mode.
 * The copies sit in their own folder, so the backup list never shows them.
 */
export async function copyBeforeUpgrade(dir: string, version: string): Promise<string | null> {
  const hasLedger = db.prepare("select 1 from sqlite_master where type = 'table' and name = 'schema_migrations'").get();
  if (!hasLedger) return null;
  const done = new Set((db.prepare("select name from schema_migrations").all() as { name: string }[]).map((r) => r.name));
  if (!done.size) return null;
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql"));
  if (files.every((f) => done.has(f))) return null;

  const target = join(dir, "before-upgrade");
  await mkdir(target, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(target, `before-upgrade-${version.replace(/[^\w.-]/g, "_")}-${stamp}.db`);
  db.prepare("vacuum into ?").run(path);

  const copies = (await readdir(target)).filter((n) => /^before-upgrade-.*\.db$/.test(n)).sort();
  for (const n of copies.slice(0, Math.max(0, copies.length - UPGRADE_COPIES_KEPT))) {
    await rm(join(target, n), { force: true });
  }
  return path;
}

export async function migrate(): Promise<{ applied: string[]; skipped: number }> {
  ensureLedger();

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await query<{ name: string; sha256: string }>(
    "select name, sha256 from schema_migrations",
  );
  const seen = new Map(rows.map((r) => [r.name, r.sha256]));

  // An older program must never open a newer database: it would run on a
  // schema it does not understand and could write data the newer version
  // reads wrongly. Restore already refuses a newer backup; this is the same
  // rule at start-up (F-U2).
  const known = new Set(files);
  const ahead = [...seen.keys()].filter((n) => !known.has(n));
  if (ahead.length) {
    throw new Error(
      `This database was made by a newer version of Offset (it holds ${ahead.length} change(s) this version does not know: ${ahead.join(", ")}). ` +
        `Update this server first, then start it again. Nothing was changed.`,
    );
  }

  const applied: string[] = [];
  let skipped = 0;

  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    const sha = createHash("sha256").update(sql).digest("hex");
    const previous = seen.get(file);

    if (previous) {
      if (previous !== sha) {
        throw new Error(
          `Migration ${file} has changed since it was applied.\n` +
            `Applied migrations are immutable — add a new migration instead.`,
        );
      }
      skipped++;
      continue;
    }

    // BEGIN IMMEDIATE takes the write lock up front, so a second process
    // starting at the same time waits rather than racing us.
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.prepare("insert into schema_migrations (name, sha256) values (?, ?)").run(file, sha);
      db.exec("COMMIT");
      applied.push(file);
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
    }
  }

  return { applied, skipped };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  migrate()
    .then(({ applied, skipped }) => {
      // eslint-disable-next-line no-console
      console.log(
        applied.length
          ? `Applied ${applied.length} migration(s):\n  ${applied.join("\n  ")}`
          : `Database is up to date (${skipped} migration(s) already applied).`,
      );
      return pool.end();
    })
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
