import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "../src/config.js";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { seedControls } from "../src/db/seed.js";
import { pool, query } from "../src/db/pool.js";

/**
 * The executive summary as a board paper, in the products that lay it out as
 * one. Skipped where the product keeps the plain layout.
 */
const OWN_FEATURES = (JSON.parse(
  readFileSync(resolve(process.cwd(), "../../packs", config.PRODUCT, "pack.json"), "utf8"),
) as { features?: Record<string, boolean> }).features ?? {};
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB && OWN_FEATURES["boardReport"] === true ? describe : describe.skip;

/** Pages in a PDF from pdfkit, which writes its page objects uncompressed. */
const pages = (pdf: Buffer): number => (pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;

maybe("board paper", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  const read = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}` });
  const write = () => ({ ...read(), "x-csrf-token": csrf });
  const paper = async (): Promise<Buffer> => {
    const res = await app.inject({ url: "/api/v1/reports/executive-summary", headers: read() });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    return res.rawPayload;
  };

  beforeAll(async () => {
    await migrate();
    for (const t of [
      "audit_log", "sessions", "users", "risk_controls", "evidence_controls", "asset_controls", "policy_controls",
      "finding_controls", "vendor_controls", "training_controls", "objective_controls", "party_controls", "review_controls",
      "controls", "programme", "risks", "evidence", "assets", "policies", "findings", "tasks", "incidents", "reviews",
      "parties", "objectives", "training", "vendors", "settings", "trend",
    ]) {
      await query(`delete from ${t}`);
    }
    await seedControls();
    app = await buildApp();
    await app.ready();
    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "admin", name: "Test Admin", email: "admin@example.test", password: "correct-horse-battery-staple" },
    });
    for (const c of boot.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(c);
      if (m?.[1] === "offset_sid") sid = m[2]!;
      if (m?.[1] === "offset_csrf") csrf = m[2]!;
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("is a two-page paper even when nothing is recorded yet", async () => {
    const pdf = await paper();
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(pdf)).toBe(2);
  });

  it("is still a paper when the framework itself has not been loaded", async () => {
    // Other suites share this database and can leave the controls table empty.
    const saved = await query<Record<string, unknown>>("select * from controls");
    await query("delete from controls");
    try {
      expect(pages(await paper())).toBe(2);
    } finally {
      await seedControls();
    }
    expect(saved.rows.length).toBeGreaterThan(0);
  });

  it("keeps one snapshot a day of its own figures, to compare the next paper with", async () => {
    await paper();
    const { rows } = await query<{ value: string }>("select value from settings where key = 'board_snapshots'");
    const list = JSON.parse(rows[0]!.value) as { day: string; headline: number }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.day).toBe(new Date().toISOString().slice(0, 10));
  });

  it("still fits on two pages with a programme in it, a decision for the board and an earlier paper", async () => {
    expect((await app.inject({ method: "POST", url: "/api/v1/demo", headers: write() })).statusCode).toBe(201);
    // A risk above appetite that nobody has accepted, and a finding past its date.
    await query(
      `update risks set treatment = 'Accept', accepted_by = null, likelihood = 4, impact = 5, res_likelihood = 4, res_impact = 4
        where seq = (select min(seq) from risks)`,
    );
    await query("update findings set status = 'Open', due_date = date('now', '-9 days') where seq = (select min(seq) from findings)");
    const before = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    await query(
      "update settings set value = $1 where key = 'board_snapshots'",
      [JSON.stringify([{ day: before, headline: 10, average: null, critical: 3, overdue: 9, atTarget: 4, evidence: 1 }])],
    );
    const pdf = await paper();
    expect(pages(pdf)).toBe(2);
    const { rows } = await query<{ value: string }>("select value from settings where key = 'board_snapshots'");
    expect((JSON.parse(rows[0]!.value) as unknown[]).length).toBe(2);
  });

  it("carries the organisation's name, which only an administrator can set", async () => {
    const set = await app.inject({ method: "PUT", url: "/api/v1/settings/organisation", headers: write(), payload: { name: "  Northwind Finance  " } });
    expect(set.statusCode).toBe(200);
    expect(set.json().organisation.name).toBe("Northwind Finance");
    expect((await app.inject({ url: "/api/v1/settings/organisation", headers: read() })).json().organisation.name).toBe("Northwind Finance");

    const long = await app.inject({ method: "PUT", url: "/api/v1/settings/organisation", headers: write(), payload: { name: "x".repeat(121) } });
    expect(long.statusCode).toBe(400);
    const stray = await app.inject({ method: "PUT", url: "/api/v1/settings/organisation", headers: write(), payload: { name: "A", extra: 1 } });
    expect(stray.statusCode).toBe(400);
    expect(pages(await paper())).toBe(2);

    const { rows } = await query<{ n: number }>("select count(*) as n from audit_log where action = 'Organisation name set'");
    expect(rows[0]!.n).toBe(1);

    // Clearing it removes it.
    await app.inject({ method: "PUT", url: "/api/v1/settings/organisation", headers: write(), payload: { name: "" } });
    expect((await app.inject({ url: "/api/v1/settings/organisation", headers: read() })).json().organisation.name).toBe("");
  });

  it("says who took the last copy of each report, and when", async () => {
    const list = (await app.inject({ url: "/api/v1/reports", headers: read() })).json().reports as
      { id: string; lastDownloaded: { at: string; by: string } | null }[];
    const exec = list.find((r) => r.id === "executive-summary")!;
    expect(exec.lastDownloaded?.by).toBe("Test Admin");
    expect(Date.now() - Date.parse(exec.lastDownloaded!.at)).toBeLessThan(60_000);
    expect(list.find((r) => r.id === "risk-register")!.lastDownloaded).toBeNull();
  });
});
