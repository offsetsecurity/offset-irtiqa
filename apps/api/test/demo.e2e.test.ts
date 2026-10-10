import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { seedControls } from "../src/db/seed.js";

/**
 * Example data, and the guides that ship in the pack.
 *
 * The dangerous half of example data is removing it, so that is what most of
 * this tests: real work sitting next to the examples has to survive, or the
 * button is not safe to offer on a live install at all.
 */
/**
 * A pack with the registers and example data this suite drives. Assure's while
 * every product shared a repository; this product's own where it has them, and
 * the suite is skipped where it does not - the feature is covered in the
 * repository of a product that has it.
 */
const ownPack = resolve(process.cwd(), "../../packs", process.env["PRODUCT"] ?? "align");
const ownFeatures = (JSON.parse(readFileSync(join(ownPack, "pack.json"), "utf8")) as {
  features?: Record<string, boolean>;
}).features ?? {};
const ASSURE_PACK = ownPack;

const DB = process.env["E2E_DATABASE_URL"];
// Also skipped where this product ships no example data.
const maybe = DB && ownFeatures["demoData"] === true ? describe : describe.skip;


maybe("example data", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";

  const read = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}` });
  const write = () => ({ ...read(), "x-csrf-token": csrf });
  const count = async (table: string): Promise<number> =>
    (await query<{ n: number }>(`select count(*) as n from ${table}`)).rows[0]?.n ?? 0;

  beforeAll(async () => {
    process.env["PACK_DIR"] = ASSURE_PACK;
    await migrate();
    for (const t of [
      "audit_log", "sessions", "users", "vendor_controls", "vendor_risks", "training_controls",
      "objective_controls", "objective_risks", "party_controls", "review_controls",
      "evidence_controls", "risk_controls", "asset_controls", "policy_controls", "finding_controls",
      "vendors", "training", "objectives", "parties", "reviews", "controls", "risks", "evidence",
      "assets", "policies", "tasks", "incidents", "findings", "programme", "settings",
    ]) {
      await query(`delete from ${t}`);
    }
    await seedControls();

    app = await buildApp();
    await app.ready();
    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: {
        username: "admin", name: "Test Admin",
        email: "admin@example.test", password: "correct-horse-battery-staple",
      },
    });
    for (const c of boot.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(c);
      if (m?.[1] === "offset_sid") sid = m[2]!;
      if (m?.[1] === "offset_csrf") csrf = m[2]!;
    }
  }, 60_000);

  afterAll(async () => {
    delete process.env["PACK_DIR"];
    await app?.close();
    await pool.end();
  });

  it("loads a joined-up example, and refuses to load it twice", async () => {
    expect((await app.inject({ url: "/api/v1/demo", headers: read() })).json().rows).toBe(0);

    const loaded = await app.inject({ method: "POST", url: "/api/v1/demo", headers: write() });
    expect(loaded.statusCode).toBe(201);
    expect(loaded.json().rows).toBeGreaterThan(30);

    // Every register a customer is asked to fill has something in it.
    for (const table of ["assets", "risks", "policies", "vendors", "training", "objectives", "parties", "reviews", "findings", "tasks", "incidents", "evidence"]) {
      expect(await count(table), `${table} is empty`).toBeGreaterThan(0);
    }

    // And the examples point at real controls rather than floating free.
    const links = await count("risk_controls");
    expect(links).toBeGreaterThan(5);

    // A third of the controls carry an opinion, so the dashboard reads as a
    // programme part way through rather than an empty one.
    const decided = await count("controls where status <> 'not_started'");
    expect(decided).toBeGreaterThan(25);

    const again = await app.inject({ method: "POST", url: "/api/v1/demo", headers: write() });
    expect(again.statusCode).toBe(400);
    expect(again.json().error).toContain("already loaded");
  });

  it("removes only what it added", async () => {
    // A row of somebody's own, in a table the examples also use.
    const mine = await app.inject({
      method: "POST", url: "/api/v1/assets", headers: write(),
      payload: { name: "Our own asset, not an example", criticality: "High" },
    });
    expect(mine.statusCode).toBe(201);

    const before = await count("assets");
    const removed = await app.inject({ method: "DELETE", url: "/api/v1/demo", headers: write() });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().removed).toBeGreaterThan(30);

    const after = await count("assets");
    expect(after).toBe(1);
    expect(after).toBeLessThan(before);

    const { rows } = await query<{ name: string }>("select name from assets");
    expect(rows[0]?.name).toBe("Our own asset, not an example");

    // The controls go back to where they were, and none is left marked.
    expect(await count("controls where status <> 'not_started'")).toBe(0);
    expect(await count("controls where json_extract(attrs, '$.demo') = 1")).toBe(0);

    expect((await app.inject({ url: "/api/v1/demo", headers: read() })).json().rows).toBe(0);
  });

  it("leaves an edited example control alone when the examples are removed", async () => {
    await app.inject({ method: "POST", url: "/api/v1/demo", headers: write() });

    const { rows } = await query<{ id: string }>("select id from controls where json_extract(attrs, '$.demo') = 1 and status = 'implemented' order by ref limit 1");
    const edited = rows[0]!.id;
    const change = await app.inject({
      method: "PATCH", url: `/api/v1/controls/${edited}`, headers: write(),
      payload: { owner: "Somebody real", notes: "We took this over from the example." },
    });
    expect(change.statusCode).toBe(200);

    await app.inject({ method: "DELETE", url: "/api/v1/demo", headers: write() });

    const after = await query<{ owner: string; status: string; attrs: string }>(
      "select owner, status, attrs from controls where id = $1",
      [edited],
    );
    expect(after.rows[0]?.owner).toBe("Somebody real");
    expect(after.rows[0]?.status).toBe("implemented");
    // No longer an example, so it is never touched again.
    expect(JSON.parse(after.rows[0]?.attrs ?? "{}").demo).toBeUndefined();
  });

  it("is for administrators only", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/demo" });
    expect(res.statusCode).toBe(401);
  });

  it("records both in the audit trail", async () => {
    const { rows } = await query<{ action: string }>(
      "select action from audit_log where entity = 'demo' order by ts",
    );
    const actions = rows.map((r) => r.action);
    // Loading and removing, in that order, every time.
    expect(new Set(actions)).toEqual(new Set(["Example data loaded", "Example data removed"]));
    for (const [i, action] of actions.entries()) {
      expect(action).toBe(i % 2 === 0 ? "Example data loaded" : "Example data removed");
    }
  });

  it("ships every guide it offers, and offers every guide it ships", async () => {
    const index = JSON.parse(await readFile(resolve(ASSURE_PACK, "help/index.json"), "utf8")) as {
      note: string;
      help: { file: string; title: string; about: string }[];
      guides: { file: string; title: string; about: string }[];
    };
    const listed = [...index.help, ...index.guides];
    expect(index.help.length).toBeGreaterThanOrEqual(4);
    expect(index.guides.length).toBeGreaterThanOrEqual(5);

    for (const page of listed) {
      expect(page.title.length).toBeGreaterThan(3);
      expect(page.about.length).toBeGreaterThan(15);
      const text = await readFile(resolve(ASSURE_PACK, "help", page.file), "utf8");
      expect(text.startsWith("# "), `${page.file} does not start with a heading`).toBe(true);
      expect(text.length, `${page.file} is too short to be a guide`).toBeGreaterThan(600);
    }

    // Nothing shipped but unreachable: a file nobody can open is a file nobody
    // maintains, and it goes stale where no one can see it.
    const onDisk = (await readdir(resolve(ASSURE_PACK, "help"))).filter((f) => f.endsWith(".md"));
    expect(onDisk.sort()).toEqual(listed.map((p) => p.file).sort());
  });
});
