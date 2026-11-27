import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";

/**
 * Every link table (a table whose whole key is two columns) can be looked up
 * from its second column without scanning the table. The first column is
 * covered by the primary key; the second needs an index of its own. Go-live
 * gate for 0.3.0, G12; the same test as Offset Assure's.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

maybe("link table indexes", () => {
  beforeAll(async () => {
    await migrate();
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  it("indexes the second column of every link table", async () => {
    const tables = (
      await query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
    ).rows.map((r) => (r as { name: string }).name);

    const links: { table: string; second: string }[] = [];
    for (const table of tables) {
      const keyed = (await query(`select name, pk from pragma_table_info('${table}') where pk > 0 order by pk`)).rows as {
        name: string;
        pk: number;
      }[];
      if (keyed.length === 2) links.push({ table, second: keyed[1]!.name });
    }
    // The nine that were missing are among them.
    expect(links.length).toBeGreaterThanOrEqual(16);

    const missing: string[] = [];
    for (const { table, second } of links) {
      const indexes = (await query(`select name from pragma_index_list('${table}') where origin = 'c'`)).rows as { name: string }[];
      let covered = false;
      for (const ix of indexes) {
        const first = (await query(`select name from pragma_index_info('${ix.name}') where seqno = 0`)).rows as { name: string }[];
        if (first[0]?.name === second) covered = true;
      }
      if (!covered) missing.push(`${table}.${second}`);
    }
    expect(missing).toEqual([]);
  });

  it("the two links that had no index now have one", async () => {
    const indexed = async (table: string, column: string): Promise<boolean> => {
      for (const ix of (await query(`select name from pragma_index_list('${table}')`)).rows as { name: string }[]) {
        const first = (await query(`select name from pragma_index_info('${ix.name}') where seqno = 0`)).rows as { name: string }[];
        if (first[0]?.name === column) return true;
      }
      return false;
    };
    expect(await indexed("tasks", "risk_id")).toBe(true);
    expect(await indexed("audit_log", "actor_id")).toBe(true);
  });
});
