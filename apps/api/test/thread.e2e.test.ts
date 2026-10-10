import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { seedIfEmpty } from "../src/db/seed.js";
import { pool, query } from "../src/db/pool.js";

/**
 * The golden thread: risks, the controls that treat them, and the proof.
 *
 * The screen judges what is broken; this checks the server hands it the
 * links and the ages it needs to judge correctly, for any product's pack.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

maybe("golden thread", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });
  let c1 = "", c2 = "";

  const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

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
      payload: { username: "threadadmin", name: "Thread Admin", email: "thread@example.test", password: "correct-horse-battery-staple" },
    });
    for (const c of boot.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(c);
      if (m?.[1] === "offset_sid") sid = m[2]!;
      if (m?.[1] === "offset_csrf") csrf = m[2]!;
    }
    const { rows } = await query<{ id: string }>("select id from controls order by ref limit 2");
    c1 = rows[0]!.id;
    c2 = rows[1]!.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("needs a session", async () => {
    expect((await app.inject({ url: "/api/v1/thread" })).statusCode).toBe(401);
  });

  it("returns every control, each risk with its controls, and linked proof with its age", async () => {
    const risk = await app.inject({
      method: "POST", url: "/api/v1/risks", headers: auth(),
      payload: { title: "Ransomware encrypts the file server", likelihood: 4, impact: 5, controlIds: [c1, c2] },
    });
    expect(risk.statusCode).toBe(201);
    const untreated = await app.inject({
      method: "POST", url: "/api/v1/risks", headers: auth(),
      payload: { title: "Cloud admin account taken over", likelihood: 3, impact: 5 },
    });
    expect(untreated.statusCode).toBe(201);
    const fresh = await app.inject({
      method: "POST", url: "/api/v1/evidence", headers: auth(),
      payload: { name: "Restore test record", collectedDate: day(-10), controlIds: [c1] },
    });
    expect(fresh.statusCode).toBe(201);
    const undated = await app.inject({
      method: "POST", url: "/api/v1/evidence", headers: auth(),
      payload: { name: "Undated screenshot", controlIds: [c2] },
    });
    expect(undated.statusCode).toBe(201);
    const loose = await app.inject({
      method: "POST", url: "/api/v1/evidence", headers: auth(),
      payload: { name: "Not linked to anything", collectedDate: day(-5) },
    });
    expect(loose.statusCode).toBe(201);

    const res = await app.inject({ url: "/api/v1/thread", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const total = (await query<{ n: number }>("select count(*) as n from controls")).rows[0]!.n;

    expect(body.staleDays).toBe(90);
    expect(body.controls).toHaveLength(total);
    // The screen needs to know a reason exists, not what it says.
    expect(body.controls.every((c: { justified: unknown; justification?: unknown }) => typeof c.justified === "boolean" && c.justification === undefined)).toBe(true)
    const r = body.risks.find((x: { title: string }) => x.title.startsWith("Ransomware"));
    expect(r.controls.sort()).toEqual([c1, c2].sort());
    expect(body.risks.find((x: { title: string }) => x.title.startsWith("Cloud")).controls).toEqual([]);

    // Only proof that backs something up is part of the thread.
    expect(body.evidence.map((e: { name: string }) => e.name).sort()).toEqual(["Restore test record", "Undated screenshot"]);
    const f = body.evidence.find((e: { name: string }) => e.name === "Restore test record");
    expect(f.ageDays).toBe(10);
    expect(f.controls).toEqual([c1]);
    expect(body.evidence.find((e: { name: string }) => e.name === "Undated screenshot").ageDays).toBeNull();
  });
});
