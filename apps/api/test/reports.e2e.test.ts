import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { config } from "../src/config.js";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { seedControls } from "../src/db/seed.js";
import { pool, query } from "../src/db/pool.js";

const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;


/**
 * A pack belonging to another product, when this repository has it.
 *
 * Some behaviour only appears for a framework that switches it on - baselines
 * for Anchor, maturity for Irtiqa, the Statement of Applicability for Assure -
 * so those tests borrow that pack. A repository that holds one product has
 * only its own, and skips the rest: the feature is still covered, in the
 * repository whose product actually has it.
 */
const packIfPresent = (id: string): string | null => {
  const dir = resolve(process.cwd(), "../../packs", id);
  return existsSync(join(dir, "pack.json")) ? dir : null;
};

const ASSURE_PACK = packIfPresent("assure");

/** What this product's own framework switches on. */
const OWN_FEATURES = (JSON.parse(
  readFileSync(resolve(process.cwd(), "../../packs", config.PRODUCT, "pack.json"), "utf8"),
) as { features?: Record<string, boolean> }).features ?? {};
const hasSoa = OWN_FEATURES["statementOfApplicability"] === true;
const ASCEND_PACK = packIfPresent("ascend");

maybe("reports", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";

  const read = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}` });

  beforeAll(async () => {
    await migrate();
    for (const t of ["audit_log", "sessions", "users", "controls", "programme", "risks", "evidence"]) {
      await query(`delete from ${t}`);
    }
    await seedControls();
    app = await buildApp();
    await app.ready();

    const boot = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
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

  it("offers only the reports this product's framework has", async () => {
    const res = await app.inject({ url: "/api/v1/reports", headers: read() });
    expect(res.statusCode).toBe(200);
    const ids = res.json().reports.map((r: { id: string }) => r.id);

    // Align has neither a Statement of Applicability nor 800-53B baselines.
    expect(ids).toContain("executive-summary");
    expect(ids).toContain("gap-report");
    // Only where the framework has one. Assure does; CSF does not.
    if (hasSoa) expect(ids).toContain("statement-of-applicability");
    else expect(ids).not.toContain("statement-of-applicability");
    const hasBaselines = OWN_FEATURES["baselines"] === true;
    if (hasBaselines) expect(ids).toContain("baseline-tailoring");
    else expect(ids).not.toContain("baseline-tailoring");
  });

  (ASSURE_PACK ? it : it.skip)("offers the Statement of Applicability when the pack declares it", async () => {
    process.env["PACK_DIR"] = ASSURE_PACK!;
    const res = await app.inject({ url: "/api/v1/reports", headers: read() });
    const ids = res.json().reports.map((r: { id: string }) => r.id);
    expect(ids).toContain("statement-of-applicability");
    delete process.env["PACK_DIR"];
  });

  it("returns a real PDF as a download", async () => {
    const res = await app.inject({ url: "/api/v1/reports/executive-summary", headers: read() });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="executive-summary-\d{4}-\d{2}-\d{2}\.pdf"$/);

    const body = res.rawPayload;
    expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(body.subarray(-6).toString("latin1")).toContain("%%EOF");
    expect(Number(res.headers["content-length"])).toBe(body.length);
  });

  it("records who exported what", async () => {
    const { rows } = await query<{ entity_id: string; actor_name: string }>(
      "select entity_id, actor_name from audit_log where action = 'Report generated'",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.entity_id)).toContain("executive-summary");
  });

  it("404s a report that does not exist, and one this product does not have", async () => {
    expect((await app.inject({ url: "/api/v1/reports/nope", headers: read() })).statusCode).toBe(404);
    // A report belonging to another framework cannot be had by guessing its
    // id. Which one that is depends on the product: a framework with a
    // Statement of Applicability is asked for a maturity assessment instead.
    const foreign = hasSoa ? "maturity-assessment" : "statement-of-applicability";
    expect(
      (await app.inject({ url: `/api/v1/reports/${foreign}`, headers: read() })).statusCode,
    ).toBe(404);
  });

  it("lets a read-only auditor export, but not an anonymous caller", async () => {
    const argon2 = (await import("argon2")).default;
    const hash = await argon2.hash("read-only-password-here", {
      type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
    });
    await query(
      `insert into users (id,username,name,email,role,auth_source,password_hash)
       values ($1,'ro','Read Only','ro@example.test','readonly','local',$2)`,
      [randomUUID(), hash],
    );
    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: "ro", password: "read-only-password-here" },
    });
    let roSid = "", roCsrf = "";
    for (const c of login.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(c);
      if (m?.[1] === "offset_sid") roSid = m[2]!;
      if (m?.[1] === "offset_csrf") roCsrf = m[2]!;
    }

    const asAuditor = await app.inject({
      url: "/api/v1/reports/gap-report",
      headers: { cookie: `offset_sid=${roSid}; offset_csrf=${roCsrf}` },
    });
    expect(asAuditor.statusCode).toBe(200);

    expect((await app.inject({ url: "/api/v1/reports" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/v1/reports/gap-report" })).statusCode).toBe(401);
  });

  it("offers the maturity assessment only to a scored framework", async () => {
    const hasMaturity = OWN_FEATURES["maturity"] === true;
    const own = await app.inject({ url: "/api/v1/reports", headers: read() });
    const ownIds = own.json().reports.map((r: { id: string }) => r.id);
    if (hasMaturity) expect(ownIds).toContain("maturity-assessment");
    else expect(ownIds).not.toContain("maturity-assessment");
    expect(
      (await app.inject({ url: "/api/v1/reports/maturity-assessment", headers: read() })).statusCode,
    ).toBe(hasMaturity ? 200 : 404);

    if (ASCEND_PACK) {
      process.env["PACK_DIR"] = ASCEND_PACK;
      const ascend = await app.inject({ url: "/api/v1/reports", headers: read() });
      expect(ascend.json().reports.map((r: { id: string }) => r.id)).toContain("maturity-assessment");
      delete process.env["PACK_DIR"];
    }
  });

  it("describes the reports by what they actually contain", async () => {
    // The gap report lists unimplemented items on a ticked framework and
    // below-target ones on a scored framework. A description that promises the
    // wrong one is a small lie on the first screen a customer sees.
    const gapIn = (res: { json: () => { reports: { id: string; description: string }[] } }) =>
      res.json().reports.find((r) => r.id === "gap-report")!.description;

    const scoredHere = OWN_FEATURES["maturity"] === true;
    const own = await app.inject({ url: "/api/v1/reports", headers: read() });
    expect(gapIn(own)).toContain(scoredHere ? "below its target level" : "not yet implemented");

    if (ASCEND_PACK) {
      process.env["PACK_DIR"] = ASCEND_PACK;
      const scored = await app.inject({ url: "/api/v1/reports", headers: read() });
      expect(gapIn(scored)).toContain("below its target level");
    }
    delete process.env["PACK_DIR"];
  });

  (ASCEND_PACK ? it : it.skip)("renders the scored reports as real PDFs", async () => {
    process.env["PACK_DIR"] = ASCEND_PACK!;

    /**
     * A spread rather than one score, so the report builds every branch it
     * has: an item above target, one below, one with its own target, and one
     * nobody has assessed.
     */
    const { rows } = await query<{ id: string }>("select id from controls order by ref limit 4");
    await query("update controls set maturity = 4 where id = $1", [rows[0]!.id]);
    await query("update controls set maturity = 1 where id = $1", [rows[1]!.id]);
    await query("update controls set maturity = 3, target_maturity = 5 where id = $1", [rows[2]!.id]);
    await query("update controls set maturity = null where id = $1", [rows[3]!.id]);

    for (const id of ["maturity-assessment", "gap-report", "executive-summary"]) {
      const res = await app.inject({ url: `/api/v1/reports/${id}`, headers: read() });
      expect(res.statusCode, id).toBe(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
      const body = res.rawPayload;
      expect(body.subarray(0, 5).toString("latin1"), id).toBe("%PDF-");
      expect(body.subarray(-6).toString("latin1"), id).toContain("%%EOF");
      // A PDF that rendered nothing is still a valid PDF. Rule out the empty one.
      expect(body.length, id).toBeGreaterThan(2000);
    }

    await query("update controls set maturity = null, target_maturity = null");
    delete process.env["PACK_DIR"];
  });

  it("keeps the two copies of the maturity scale in step", async () => {
    /**
     * The scale is written out twice on purpose - the screen needs it and so
     * does the PDF, which is read by people who never saw the screen. Two
     * copies drift, so this compares them and fails when they do. Sharing the
     * constant instead would mean the API importing from the web bundle,
     * which is a worse trade than one test.
     */
    const grab = async (file: string): Promise<string> => {
      const src = await readFile(resolve(process.cwd(), file), "utf8");
      const m = /MATURITY_LEVELS[^=]*=\s*\[([\s\S]*?)\];/.exec(src);
      expect(m, `no MATURITY_LEVELS in ${file}`).toBeTruthy();
      return m![1]!.replace(/\s+/g, " ").trim();
    };

    expect(await grab("src/reports/definitions.ts")).toBe(
      await grab("../web/src/ui/format.ts"),
    );
  });
});
