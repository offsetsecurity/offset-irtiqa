import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";

/**
 * G11 of the go-live gate for 0.3.0 (27 Nov 2026; F6 in Offset Assure): a
 * register named like a built-in property of every object ("constructor")
 * was taken for one that takes attachments, and the server answered 500.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;
const PASSWORD = "correct-horse-battery-staple";

maybe("a register is one of the product's own", () => {
  let app: FastifyInstance;
  let headers: Record<string, string> = {};

  beforeAll(async () => {
    await migrate();
    for (const t of ["audit_log", "sessions", "users"]) await query(`delete from ${t}`);
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

  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    it(`G11: "${name}" is refused as a register, plainly`, async () => {
      const res = await app.inject({ url: `/api/v1/attachments/${name}/11111111-1111-4111-8111-111111111111`, headers });
      expect(res.statusCode, res.body).toBe(400);
    });
  }
});
