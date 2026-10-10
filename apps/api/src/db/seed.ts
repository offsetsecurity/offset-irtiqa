import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query, withTransaction } from "./pool.js";
import { product } from "../config.js";
import { packDir } from "../lib/pack.js";

interface PackControl {
  ref: string;
  title: string;
  theme: string;
  parentRef?: string | null;
}

/**
 * Idempotent. Inserts controls that are missing and refreshes the framework
 * text on ones that exist, but never touches operator-owned columns (status,
 * owner, notes, justification, attrs) — so re-seeding after a framework update
 * is safe and does not discard anyone's work.
 */
export async function seedControls(): Promise<{ inserted: number; updated: number; total: number }> {
  const dir = packDir();
  const controls: PackControl[] = JSON.parse(await readFile(join(dir, "controls.json"), "utf8"));

  if (!controls.length) throw new Error(`Pack at ${dir} contains no controls.`);

  const existing = new Set(
    (await query<{ ref: string }>("select ref from controls")).rows.map((r) => r.ref),
  );

  let inserted = 0;
  let updated = 0;

  await withTransaction(async (tx) => {
    for (const c of controls) {
      if (existing.has(c.ref)) {
        await tx.query(
          "update controls set title = $1, theme = $2, parent_ref = $3 where ref = $4",
          [c.title, c.theme, c.parentRef ?? null, c.ref],
        );
        updated++;
      } else {
        await tx.query(
          "insert into controls (id, ref, title, theme, parent_ref) values ($1, $2, $3, $4, $5)",
          [randomUUID(), c.ref, c.title, c.theme, c.parentRef ?? null],
        );
        inserted++;
      }
    }
  });

  return { inserted, updated, total: controls.length };
}

/** Called on boot: only seeds when the table is empty, so it is cheap and safe. */
export async function seedIfEmpty(): Promise<boolean> {
  const { rows } = await query<{ n: number }>("select count(*) as n from controls");
  if ((rows[0]?.n ?? 0) > 0) return false;
  await seedControls();
  return true;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  seedControls()
    .then(({ inserted, updated, total }) => {
      // eslint-disable-next-line no-console
      console.log(
        `${product.name}: seeded ${total} items from the pack (${inserted} new, ${updated} refreshed).`,
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
