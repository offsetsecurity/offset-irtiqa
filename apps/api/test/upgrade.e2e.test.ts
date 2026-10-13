import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { seedIfEmpty } from "../src/db/seed.js";
import { db, pool, query } from "../src/db/pool.js";
import { hashPassword } from "../src/auth/password.js";

/**
 * A customer's database from an older version, upgraded to this one.
 *
 * Every other suite starts from an empty, current database, so none of them
 * would notice a migration that breaks existing rows. This one builds the
 * database as an older release left it, fills it the way a customer would,
 * runs the upgrade the product runs on start, and checks that nothing was lost
 * and the new features work on the old data.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

const MIGRATIONS = resolve(import.meta.dirname, "../src/db/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

/** Drops every table and index, leaving an empty file. */
function wipe(): void {
  db.exec("PRAGMA foreign_keys = OFF");
  const objects = db.prepare("select type, name from sqlite_master where name not like 'sqlite_%' and type in ('table','view')").all() as { type: string; name: string }[];
  for (const o of objects) db.exec(`drop ${o.type} if exists "${o.name}"`);
  db.exec("PRAGMA foreign_keys = ON");
}

/** Builds the database exactly as the first `count` migrations left it, ledger included. */
function oldVersion(count: number): void {
  wipe();
  db.exec(`create table schema_migrations (name text primary key, sha256 text not null,
           applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  for (const f of files.slice(0, count)) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    db.exec(sql);
    db.prepare("insert into schema_migrations (name, sha256) values (?, ?)")
      .run(f, createHash("sha256").update(sql).digest("hex"));
  }
}

const PASSWORD = "an old customer's long passphrase";
const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  c1: "22222222-2222-4222-8222-222222222221",
  c2: "22222222-2222-4222-8222-222222222222",
  risk: "33333333-3333-4333-8333-333333333333",
  evidence: "44444444-4444-4444-8444-444444444444",
};
const today = new Date().toISOString().slice(0, 10);

/** What a customer had in the old version: an administrator, controls, a risk, evidence, the links, and scope. */
async function oldCustomerData(withAssets: boolean): Promise<void> {
  const hash = await hashPassword(PASSWORD);
  db.prepare("insert into users (id, username, email, name, role, password_hash) values (?, 'oldadmin', 'old@example.test', 'Old Admin', 'admin', ?)")
    .run(ids.user, hash);
  db.prepare("insert into controls (id, ref, title, theme, status, owner, justification) values (?, 'A.5.1', 'Policies for information security', 'A.5 Organizational', 'implemented', 'CISO', 'Required by the board')")
    .run(ids.c1);
  db.prepare("insert into controls (id, ref, title, theme, status) values (?, 'A.5.15', 'Access control', 'A.5 Organizational', 'in_progress')")
    .run(ids.c2);
  db.prepare("insert into risks (id, seq, title, likelihood, impact, owner) values (?, 1, 'Laptop stolen from a car', 3, 4, 'IT Manager')")
    .run(ids.risk);
  db.prepare("insert into risk_controls (risk_id, control_id) values (?, ?)").run(ids.risk, ids.c1);
  db.prepare("insert into evidence (id, name, collected_date) values (?, 'Signed information security policy', ?)")
    .run(ids.evidence, today);
  db.prepare("insert into evidence_controls (evidence_id, control_id) values (?, ?)").run(ids.evidence, ids.c1);
  db.prepare("insert or ignore into programme (id) values (1)").run();
  db.prepare("update programme set scope = 'Head office and the customer portal', methodology = '5x5, owner accepts up to 11' where id = 1").run();
  if (withAssets) {
    db.prepare("insert into assets (id, seq, name, owner) values ('55555555-5555-4555-8555-555555555555', 1, 'Customer database', 'DBA')").run();
  }
}

maybe("upgrading a customer's database from an older version", () => {
  afterAll(async () => {
    // Leave the shared test database complete and current for the suites after this one.
    wipe();
    await migrate();
    await seedIfEmpty();
    await pool.end();
  });

  // The first release, one in the middle, and the one before the newest change.
  const starts = [...new Set([1, 2, Math.ceil(files.length / 2), files.length - 1])];

  describe.each(starts)("from the version with %i of the migrations", (count) => {
    let app: FastifyInstance;
    let applied: string[] = [];

    beforeAll(async () => {
      oldVersion(count);
      await oldCustomerData(count >= 2);
      applied = (await migrate()).applied;
      app = await buildApp();
      await app.ready();
    }, 60_000);

    afterAll(async () => { await app?.close(); });

    it("applies every newer change, once, in order", async () => {
      expect(applied).toEqual(files.slice(count));
      expect((await migrate()).applied).toEqual([]);
    });

    it("keeps the old administrator able to sign in", async () => {
      const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "oldadmin", password: PASSWORD } });
      expect(res.statusCode).toBe(200);
    });

    it("keeps every row: controls, the risk, the evidence, the links and the scope", async () => {
      const n = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
      expect(n("select count(*) as n from controls")).toBe(2);
      expect(n("select count(*) as n from risks")).toBe(1);
      expect(n("select count(*) as n from evidence")).toBe(1);
      expect(n("select count(*) as n from risk_controls")).toBe(1);
      expect(n("select count(*) as n from evidence_controls")).toBe(1);
      const c1 = db.prepare("select status, owner, justification from controls where id = ?").get(ids.c1) as Record<string, string>;
      expect(c1).toEqual({ status: "implemented", owner: "CISO", justification: "Required by the board" });
      const prog = (await query<{ scope: string; methodology: string }>("select scope, methodology from programme where id = 1")).rows[0];
      expect(prog).toEqual({ scope: "Head office and the customer portal", methodology: "5x5, owner accepts up to 11" });
      if (count >= 2) expect(n("select count(*) as n from assets")).toBe(1);
    });

    it("shows the old data through today's screens and features", async () => {
      const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "oldadmin", password: PASSWORD } });
      const cookies = (login.headers["set-cookie"] as string[]).map((c) => c.split(";")[0]).join("; ");
      const csrf = /offset_csrf=([^;]+)/.exec(cookies)![1]!;
      const auth = { cookie: cookies, "x-csrf-token": csrf };

      const risks = (await app.inject({ url: "/api/v1/risks", headers: auth })).json().risks as { title: string; control_ids: string[] }[];
      expect(risks.map((r) => r.title)).toEqual(["Laptop stolen from a car"]);
      expect(risks[0]!.control_ids).toEqual([ids.c1]);

      const thread = (await app.inject({ url: `/api/v1/thread/control/${ids.c1}`, headers: auth })).json();
      expect(thread.risks.map((r: { title: string }) => r.title)).toEqual(["Laptop stolen from a car"]);
      expect(thread.evidence.map((e: { name: string }) => e.name)).toEqual(["Signed information security policy"]);

      // Something added since the old version, used on the old data.
      const linked = await app.inject({ method: "PUT", url: `/api/v1/controls/${ids.c2}/risks`, headers: auth, payload: { riskIds: [ids.risk] } });
      expect(linked.statusCode).toBe(200);
      const edited = await app.inject({ method: "PATCH", url: `/api/v1/controls/${ids.c2}`, headers: auth, payload: { owner: "IT Manager" } });
      expect(edited.statusCode).toBe(200);
    });
  });
});
