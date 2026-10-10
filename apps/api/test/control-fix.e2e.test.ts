import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { seedIfEmpty } from "../src/db/seed.js";
import { pool, query } from "../src/db/pool.js";

/**
 * One control's part of the Golden thread, behind its "How to fix this" list:
 * the risks it treats, the evidence behind it and its age, and its tests.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

maybe("a control's part of the thread", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  let control = "";
  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });

  beforeAll(async () => {
    await migrate();
    await seedIfEmpty();
    for (const t of ["audit_log", "sessions", "users", "risk_controls", "risks", "evidence_controls", "evidence"]) {
      await query(`delete from ${t}`);
    }
    app = await buildApp();
    await app.ready();
    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "fixadmin", name: "Fix Admin", email: "fix@example.test", password: "correct-horse-battery-staple" },
    });
    for (const c of boot.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(c);
      if (m?.[1] === "offset_sid") sid = m[2]!;
      if (m?.[1] === "offset_csrf") csrf = m[2]!;
    }
    control = (await query<{ id: string }>("select id from controls order by ref limit 1")).rows[0]!.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("needs a session, and a real control", async () => {
    expect((await app.inject({ url: `/api/v1/thread/control/${control}` })).statusCode).toBe(401);
    const missing = await app.inject({ url: "/api/v1/thread/control/00000000-0000-4000-8000-000000000000", headers: auth() });
    expect(missing.statusCode).toBe(404);
  });

  it("starts empty: no risk, no evidence, no test", async () => {
    const res = await app.inject({ url: `/api/v1/thread/control/${control}`, headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.risks).toEqual([]);
    expect(body.evidence).toEqual([]);
    expect(body.tests.count).toBe(0);
    expect(body.staleDays).toBeGreaterThan(0);
  });

  it("shows the risks it treats and the age of its evidence", async () => {
    const risk = await app.inject({
      method: "POST", url: "/api/v1/risks", headers: auth(),
      payload: { title: "Laptop stolen from a car", likelihood: 3, impact: 4, controlIds: [control] },
    });
    expect(risk.statusCode).toBe(201);
    const old = new Date(Date.now() - 200 * 864e5).toISOString().slice(0, 10);
    const ev = await app.inject({
      method: "POST", url: "/api/v1/evidence", headers: auth(),
      payload: { name: "Encryption report", collectedDate: old, controlIds: [control] },
    });
    expect(ev.statusCode).toBe(201);
    const body = (await app.inject({ url: `/api/v1/thread/control/${control}`, headers: auth() })).json();
    expect(body.risks.map((r: { title: string }) => r.title)).toEqual(["Laptop stolen from a car"]);
    expect(body.evidence).toHaveLength(1);
    expect(body.evidence[0].ageDays).toBeGreaterThanOrEqual(199);
  });

  it("links risks from the control's side, and the risk register sees the same link", async () => {
    const made = await app.inject({
      method: "POST", url: "/api/v1/risks", headers: auth(),
      payload: { title: "Shared admin password leaks", likelihood: 2, impact: 4 },
    });
    const riskId = made.json().risk.id as string;
    const put = await app.inject({ method: "PUT", url: `/api/v1/controls/${control}/risks`, headers: auth(), payload: { riskIds: [riskId] } });
    expect(put.statusCode).toBe(200);
    expect(put.json().risks.map((r: { title: string }) => r.title)).toContain("Shared admin password leaks");

    const risk = (await app.inject({ url: "/api/v1/risks", headers: auth() })).json().risks
      .find((r: { id: string }) => r.id === riskId);
    expect(risk.control_ids).toEqual([control]);

    const cleared = await app.inject({ method: "PUT", url: `/api/v1/controls/${control}/risks`, headers: auth(), payload: { riskIds: [] } });
    expect(cleared.json().risks).toEqual([]);
  });

  it("refuses a risk that does not exist, and a control that does not exist", async () => {
    const ghost = "00000000-0000-4000-8000-000000000000";
    expect((await app.inject({ method: "PUT", url: `/api/v1/controls/${control}/risks`, headers: auth(), payload: { riskIds: [ghost] } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: `/api/v1/controls/${ghost}/risks`, headers: auth(), payload: { riskIds: [] } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: `/api/v1/controls/${control}/risks`, payload: { riskIds: [] } })).statusCode).toBe(401);
  });
});
