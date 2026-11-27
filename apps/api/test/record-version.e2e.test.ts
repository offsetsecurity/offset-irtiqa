import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { seedControls } from "../src/db/seed.js";
import { pool, query } from "../src/db/pool.js";
import { CHANGED_MEANWHILE } from "../src/lib/record-version.js";

/**
 * GL-5 (go-live check, 15 Nov 2026): two people editing the same record. The
 * second save, made from what the record looked like before the first one,
 * is refused with plain words instead of silently overwriting the first.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;
const PASSWORD = "correct-horse-battery-staple";
const pause = () => new Promise((r) => setTimeout(r, 15));

maybe("GL-5: a record changed meanwhile is not overwritten", () => {
  let app: FastifyInstance;
  let headers: Record<string, string> = {};

  const read = async (path: string, key: string) => {
    const res = await app.inject({ method: "GET", url: path, headers });
    const body = res.json() as Record<string, Record<string, unknown>>;
    return (body[key] ?? body) as Record<string, unknown>;
  };
  const save = (path: string, payload: Record<string, unknown>, version?: string) =>
    app.inject({ method: "PATCH", url: path, headers: { ...headers, ...(version ? { "x-record-version": version } : {}) }, payload });

  beforeAll(async () => {
    await migrate();
    for (const t of ["audit_log", "sessions", "users"]) await query(`delete from ${t}`);
    await query("delete from controls");
    await seedControls();
    app = await buildApp();
    await app.ready();
    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "keeper", name: "The Keeper", email: "keeper@example.test", password: PASSWORD },
    });
    expect(boot.statusCode).toBe(201);
    const set = ([boot.headers["set-cookie"] ?? []].flat() as string[]).join(";");
    const sid = /offset_sid=([^;]+)/.exec(set)?.[1] ?? "";
    const csrf = /offset_csrf=([^;]+)/.exec(set)?.[1] ?? "";
    headers = { cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf };
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  const cases: { name: string; create: () => Promise<string>; path: (id: string) => string; key: string; change: (n: number) => Record<string, unknown> }[] = [
    {
      name: "a risk",
      create: async () => ((await app.inject({ method: "POST", url: "/api/v1/risks", headers, payload: { title: "Version check risk", likelihood: 2, impact: 2 } })).json() as { risk: { id: string } }).risk.id,
      path: (id) => `/api/v1/risks/${id}`, key: "risk", change: (n) => ({ title: `Version check risk ${n}` }),
    },
    {
      name: "a control",
      create: async () => (await query<{ id: string }>("select id from controls order by ref limit 1")).rows[0]!.id,
      path: (id) => `/api/v1/controls/${id}`, key: "control", change: (n) => ({ notes: `Changed ${n}` }),
    },
    {
      name: "evidence",
      create: async () => ((await app.inject({ method: "POST", url: "/api/v1/evidence", headers, payload: { name: "Version check evidence" } })).json() as { evidence: { id: string } }).evidence.id,
      path: (id) => `/api/v1/evidence/${id}`, key: "evidence", change: (n) => ({ notes: `Changed ${n}` }),
    },
    {
      name: "a register entry (a task)",
      create: async () => ((await app.inject({ method: "POST", url: "/api/v1/tasks", headers, payload: { title: "Version check task" } })).json() as { task: { id: string } }).task.id,
      path: (id) => `/api/v1/tasks/${id}`, key: "task", change: (n) => ({ title: `Version check task ${n}` }),
    },
  ];

  for (const c of cases) {
    it(`GL-5: ${c.name}: the first save goes through, the second from the old version is refused`, async () => {
      const id = await c.create();
      const seen = String((await read(c.path(id), c.key))["updated_at"]);
      expect(seen).toMatch(/^\d{4}-/);
      await pause();
      const first = await save(c.path(id), c.change(1), seen);
      expect(first.statusCode, first.body).toBe(200);
      await pause();
      const second = await save(c.path(id), c.change(2), seen);
      expect(second.statusCode, second.body).toBe(409);
      expect(second.json().error).toBe(CHANGED_MEANWHILE);
      // Read again, and the change goes through.
      const fresh = String((await read(c.path(id), c.key))["updated_at"]);
      expect(fresh).not.toBe(seen);
      const third = await save(c.path(id), c.change(3), fresh);
      expect(third.statusCode, third.body).toBe(200);
      // Without the header nothing is checked, as before.
      await pause();
      expect((await save(c.path(id), c.change(4))).statusCode).toBe(200);
    });
  }
});
