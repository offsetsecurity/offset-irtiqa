import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { copyBeforeUpgrade, migrate, UPGRADE_COPIES_KEPT } from "../src/db/migrate.js";
import { db, pool } from "../src/db/pool.js";

/**
 * Two promises made at every start-up:
 *  - F-U1: before any change is applied to an existing database, a copy is
 *    taken, so an upgrade can be undone (migrations only go forward).
 *  - F-U2: an older program refuses a database a newer one has changed.
 *
 * G2 of the go-live gate for 0.3.0 (27 Nov 2026); the same fix and tests as
 * Offset Assure's.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

const MIGRATIONS = resolve(import.meta.dirname, "../src/db/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

function wipe(): void {
  db.exec("PRAGMA foreign_keys = OFF");
  const objects = db.prepare("select type, name from sqlite_master where name not like 'sqlite_%' and type in ('table','view')").all() as { type: string; name: string }[];
  for (const o of objects) db.exec(`drop ${o.type} if exists "${o.name}"`);
  db.exec("PRAGMA foreign_keys = ON");
}

/** The database as the release with the first `count` migrations left it. */
function oldVersion(count: number): void {
  wipe();
  db.exec(`create table schema_migrations (name text primary key, sha256 text not null,
           applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  for (const f of files.slice(0, count)) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    db.exec(sql);
    db.prepare("insert into schema_migrations (name, sha256) values (?, ?)").run(f, createHash("sha256").update(sql).digest("hex"));
  }
}

maybe("upgrade safety", () => {
  const dir = mkdtempSync(join(tmpdir(), "offset-upgrade-"));
  beforeEach(() => rmSync(join(dir, "before-upgrade"), { recursive: true, force: true }));
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    wipe();
    await migrate();
    await pool.end();
  });

  it("F-U1: copies a database that has changes waiting, and the copy is whole", async () => {
    oldVersion(files.length - 1);
    db.prepare("insert into settings (key, value) values ('probe', '\"kept\"')").run();
    const path = await copyBeforeUpgrade(dir, "1.2.3");
    expect(path).toMatch(/before-upgrade-.*-1\.2\.3\.db$/);
    expect(existsSync(path!)).toBe(true);
    const copy = new Database(path!, { readonly: true });
    try {
      expect(copy.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
      expect(copy.prepare("select value from settings where key = 'probe'").get()).toEqual({ value: '"kept"' });
      // The copy is the old database: the newest change is not in it.
      expect((copy.prepare("select count(*) as n from schema_migrations").get() as { n: number }).n).toBe(files.length - 1);
    } finally {
      copy.close();
    }
  });

  it("F-U1: takes no copy of a new database, or one that is up to date", async () => {
    wipe();
    expect(await copyBeforeUpgrade(dir, "1.2.3")).toBeNull();
    await migrate();
    expect(await copyBeforeUpgrade(dir, "1.2.3")).toBeNull();
    expect(existsSync(join(dir, "before-upgrade"))).toBe(false);
  });

  it("F-U1: keeps only the newest few copies", async () => {
    for (let i = 0; i < UPGRADE_COPIES_KEPT + 2; i++) {
      oldVersion(files.length - 1);
      await copyBeforeUpgrade(dir, `1.0.${i}`);
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(readdirSync(join(dir, "before-upgrade"))).toHaveLength(UPGRADE_COPIES_KEPT);
  });

  it("F-U1: the copy just made is kept when the version number grows a digit (0.9 to 0.10)", async () => {
    let newest = "";
    for (const v of ["0.9.7", "0.9.8", "0.9.9", "0.10.0"]) {
      oldVersion(files.length - 1);
      newest = (await copyBeforeUpgrade(dir, v))!;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(existsSync(newest), "the newest copy was deleted at once").toBe(true);
    const kept = readdirSync(join(dir, "before-upgrade"));
    expect(kept).toHaveLength(UPGRADE_COPIES_KEPT);
    expect(kept.some((n) => n.includes("0.9.7")), "the oldest copy should be the one removed").toBe(false);
  });

  it("F-U2: an older program refuses a newer database and changes nothing", async () => {
    oldVersion(files.length - 1);
    db.prepare("insert into schema_migrations (name, sha256) values ('9999_from_the_future.sql', 'x')").run();
    await expect(migrate()).rejects.toThrow(/newer version of Offset.*Update this server first/s);
    const n = (db.prepare("select count(*) as n from schema_migrations").get() as { n: number }).n;
    expect(n).toBe(files.length); // (count - 1) real ones + the future one: the last real one was not applied
  });
});
