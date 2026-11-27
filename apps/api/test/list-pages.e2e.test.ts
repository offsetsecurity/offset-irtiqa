import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";

/**
 * G13 of the go-live gate for 0.3.0 (27 Nov 2026): a list of 5,000 risks or
 * assets came back whole, 2 to 3 MB in one answer. A client may now ask for
 * one page (`limit`, `offset`) and is told the total; the screens send
 * neither and get the whole list as before. The same as Offset Assure.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;
const PASSWORD = "correct-horse-battery-staple";

maybe("big lists come in pages when asked", () => {
  let app: FastifyInstance;
  let headers: Record<string, string> = {};
  const get = (url: string) => app.inject({ url, headers });

  beforeAll(async () => {
    await migrate();
    for (const t of ["audit_log", "sessions", "users", "evidence_controls", "evidence", "risk_controls", "asset_risks", "asset_controls", "risks", "assets"]) await query(`delete from ${t}`);
    app = await buildApp();
    await app.ready();
    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "pager", name: "Pat Pager", email: "pager@example.test", password: PASSWORD },
    });
    expect(boot.statusCode).toBe(201);
    const set = ([boot.headers["set-cookie"] ?? []].flat() as string[]).join(";");
    const sid = /offset_sid=([^;]+)/.exec(set)?.[1] ?? "";
    const csrf = /offset_csrf=([^;]+)/.exec(set)?.[1] ?? "";
    headers = { cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf };
    for (let i = 0; i < 25; i++) {
      for (const [url, payload] of [
        ["/api/v1/risks", { title: `Paged risk ${i}`, likelihood: 1 + (i % 5), impact: 1 + ((i * 3) % 5), owner: i % 2 ? "Odd Owner" : "Even Owner" }],
        ["/api/v1/assets", { name: `Paged asset ${i}`, owner: "Asset Owner", criticality: "Medium" }],
        ["/api/v1/evidence", { name: `Paged evidence ${i}`, owner: "Evidence Owner" }],
      ] as const) {
        const res = await app.inject({ method: "POST", url, headers, payload });
        expect(res.statusCode, res.body).toBe(201);
      }
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  for (const [url, key] of [["/api/v1/risks", "risks"], ["/api/v1/assets", "assets"], ["/api/v1/evidence", "evidence"]] as const) {
    it(`G13: ${url} pages cover the whole list once, in the same order, with the total`, async () => {
      const whole = (await get(url)).json() as Record<string, { id: string }[]> & { total?: number };
      expect(whole[key]).toHaveLength(25);
      expect(whole.total, "the screens' whole list is unchanged").toBeUndefined();
      const seen: string[] = [];
      for (let offset = 0; offset < 25; offset += 10) {
        const page = (await get(`${url}?limit=10&offset=${offset}`)).json() as Record<string, { id: string }[]> & { total: number };
        expect(page.total).toBe(25);
        expect(page[key]!.length).toBe(Math.min(10, 25 - offset));
        seen.push(...page[key]!.map((r) => r.id));
      }
      expect(seen).toEqual(whole[key]!.map((r) => r.id));
    });
  }

  it("G13: a filter and a page together count only what the filter keeps", async () => {
    const page = (await get("/api/v1/risks?owner=Odd%20Owner&limit=5")).json() as { risks: unknown[]; total: number };
    expect(page.total).toBe(12);
    expect(page.risks).toHaveLength(5);
  });

  it("G13: a page too big, or a band or freshness with a page, is refused plainly", async () => {
    expect((await get("/api/v1/risks?limit=501")).statusCode).toBe(400);
    expect((await get("/api/v1/assets?limit=0")).statusCode).toBe(400);
    expect((await get("/api/v1/risks?limit=5&band=critical")).statusCode).toBe(400);
    expect((await get("/api/v1/evidence?limit=5&freshness=fresh")).statusCode).toBe(400);
  });
});
