import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { resetAddressLimits } from "../src/auth/address-limit.js";

/**
 * G10 of the go-live gate for 0.3.0 (27 Nov 2026; F3 in Offset Assure): a wrong password for a disabled or a
 * locked account must cost the same password check as for any other account,
 * or the time of the answer tells a stranger which accounts are disabled or
 * locked. Timing itself is too noisy to assert, so this counts the checks.
 */
vi.mock("../src/auth/password.js", async (original) => {
  const real = await original<typeof import("../src/auth/password.js")>();
  return { ...real, verifyPassword: vi.fn(real.verifyPassword) };
});
const { verifyPassword } = await import("../src/auth/password.js");
const checks = verifyPassword as unknown as ReturnType<typeof vi.fn>;

const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;
const PASSWORD = "correct-horse-battery-staple";

maybe("G10: sign-in costs one password check, whatever the account's state", () => {
  let app: FastifyInstance;
  let cookie = "";
  let csrf = "";

  const make = async (username: string) => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/users", headers: { cookie, "x-csrf-token": csrf },
      payload: { username, name: `Timing ${username}`, email: `${username}@example.test`, role: "contributor", password: PASSWORD },
    });
    expect(res.statusCode, res.body).toBe(201);
  };
  const countedLogin = async (username: string) => {
    resetAddressLimits();
    checks.mockClear();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "a-wrong-password-entirely" } });
    return { status: res.statusCode, checks: checks.mock.calls.length };
  };

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
    const set = [boot.headers["set-cookie"] ?? []].flat() as string[];
    const sid = /offset_sid=([^;]+)/.exec(set.join(";"))?.[1] ?? "";
    csrf = /offset_csrf=([^;]+)/.exec(set.join(";"))?.[1] ?? "";
    cookie = `offset_sid=${sid}; offset_csrf=${csrf}`;
    await make("timing-active");
    await make("timing-disabled");
    await make("timing-locked");
    await query("update users set disabled = 1 where username = 'timing-disabled'");
    await query("update users set locked_until = $1 where username = 'timing-locked'", [new Date(Date.now() + 3_600_000).toISOString()]);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("G10: an active account with a wrong password: one check (the baseline)", async () => {
    const r = await countedLogin("timing-active");
    expect(r.status).toBe(401);
    expect(r.checks).toBeGreaterThanOrEqual(1);
  });

  it("G10: a disabled account costs a check too, and gets the same answer", async () => {
    const base = await countedLogin("timing-active");
    const r = await countedLogin("timing-disabled");
    expect(r.status).toBe(401);
    expect(r.checks).toBe(base.checks);
  });

  it("G10: a locked account costs a check too, and gets the same answer", async () => {
    const base = await countedLogin("timing-active");
    const r = await countedLogin("timing-locked");
    expect(r.status).toBe(401);
    expect(r.checks).toBe(base.checks);
  });

  it("G10: a name with no account costs a check too", async () => {
    const base = await countedLogin("timing-active");
    const r = await countedLogin("nobody-by-this-name");
    expect(r.status).toBe(401);
    expect(r.checks).toBe(base.checks);
  });
});
