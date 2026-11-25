import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { resetAddressLimits } from "../src/auth/address-limit.js";

/**
 * The Global Settings page's Overview reads one answer from the server: a box
 * for each section and the facts about this server. Administrators only.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;
const PASSWORD = "correct-horse-battery-staple";

type Session = Record<string, string>;
const sessionOf = (res: { headers: Record<string, unknown> }): Session => {
  const set = ([res.headers["set-cookie"] ?? []].flat() as string[]).join(";");
  const sid = /offset_sid=([^;]+)/.exec(set)?.[1] ?? "";
  const csrf = /offset_csrf=([^;]+)/.exec(set)?.[1] ?? "";
  return { cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf };
};

maybe("the Settings Overview", () => {
  let app: FastifyInstance;
  let admin: Session;
  let reader: Session;

  beforeAll(async () => {
    await migrate();
    for (const t of ["audit_log", "sessions", "users"]) await query(`delete from ${t}`);
    resetAddressLimits();
    app = await buildApp();
    await app.ready();
    admin = sessionOf(await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "keeper", name: "Sam Keeper", email: "keeper@example.test", password: PASSWORD },
    }));
    await app.inject({
      method: "POST", url: "/api/v1/users", headers: admin,
      payload: { username: "reader", name: "Robin Reader", email: "reader@example.test", role: "readonly", password: PASSWORD },
    });
    reader = sessionOf(await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "reader", password: PASSWORD } }));
  }, 60_000);

  afterAll(async () => {
    resetAddressLimits();
    await app?.close();
    await pool.end();
  });

  it("an administrator gets every section and the server facts; Offset Irtiqa has no AI assistants", async () => {
    const res = await app.inject({ url: "/api/v1/settings/overview", headers: admin });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    for (const part of ["server", "https", "email", "digest", "history"]) expect(body, part).toHaveProperty(part);
    expect(body.server.people).toMatchObject({ admin: 1, readonly: 1 });
    expect(body).not.toHaveProperty("ai");
  });

  it("anybody else is refused", async () => {
    expect((await app.inject({ url: "/api/v1/settings/overview", headers: reader })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/v1/settings/overview" })).statusCode).toBe(401);
  });
});
