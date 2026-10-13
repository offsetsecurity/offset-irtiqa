import { readdir, readFile } from "node:fs/promises";
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

export async function migrate(): Promise<{ applied: string[]; skipped: number }> {
  ensureLedger();

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await query<{ name: string; sha256: string }>(
    "select name, sha256 from schema_migrations",
  );
  const seen = new Map(rows.map((r) => [r.name, r.sha256]));

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
