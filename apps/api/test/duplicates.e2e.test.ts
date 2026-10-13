import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { seedIfEmpty } from "../src/db/seed.js";
import { pool, query } from "../src/db/pool.js";

/** A risk is in the register once, however it arrives. */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

maybe("a risk is never in the register twice", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });

  beforeAll(async () => {
    await migrate();
    await seedIfEmpty();
    for (const t of ["audit_log", "sessions", "users", "risk_controls", "risks", "evidence_controls", "evidence", "assets"]) {
      await query(`delete from ${t}`);
    }
    app = await buildApp();
    await app.ready();
    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "dupadmin", name: "Dup Admin", email: "dup@example.test", password: "correct-horse-battery-staple" },
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

  it("refuses a second risk with the same title, ignoring case and spacing", async () => {
    const first = await app.inject({ method: "POST", url: "/api/v1/risks", headers: auth(), payload: { title: "Staff credentials taken by phishing", likelihood: 4, impact: 4 } });
    expect(first.statusCode).toBe(201);
    const again = await app.inject({ method: "POST", url: "/api/v1/risks", headers: auth(), payload: { title: "  staff CREDENTIALS taken by phishing ", likelihood: 2, impact: 2 } });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toContain(`#${first.json().risk.seq}`);
  });

  it("lets a risk keep its own title when it is edited", async () => {
    const r = (await query<{ id: string }>("select id from risks limit 1")).rows[0]!;
    const res = await app.inject({ method: "PATCH", url: `/api/v1/risks/${r.id}`, headers: auth(), payload: { title: "Staff credentials taken by phishing", owner: "IT Manager" } });
    expect(res.statusCode).toBe(200);
  });

  it("loads the example data without adding a second copy of a risk already there", async () => {
    // Another suite may have left the examples loaded; start without them.
    await app.inject({ method: "DELETE", url: "/api/v1/demo", headers: auth() });
    const res = await app.inject({ method: "POST", url: "/api/v1/demo", headers: auth(), payload: {} });
    if (res.statusCode === 400 && /does not ship example data/.test(res.body)) return;
    expect([200, 201]).toContain(res.statusCode);
    const { rows } = await query<{ n: number }>("select count(*) as n from risks where lower(title) = 'staff credentials taken by phishing'");
    expect(Number(rows[0]!.n)).toBe(1);
  });
});
