import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";

/**
 * User administration. The interesting tests are the refusals: an
 * administrator must not be able to lock everyone, including themselves, out
 * of their own instance.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

maybe("user administration", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  let adminId = "";

  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });
  const read = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}` });

  const cookiesFrom = (res: { headers: Record<string, unknown> }): [string, string] => {
    let s = "", c = "";
    for (const raw of res.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(raw);
      if (m?.[1] === "offset_sid") s = m[2]!;
      if (m?.[1] === "offset_csrf") c = m[2]!;
    }
    return [s, c];
  };

  beforeAll(async () => {
    await migrate();
    for (const t of ["audit_log", "sessions", "users"]) await query(`delete from ${t}`);
    app = await buildApp();
    await app.ready();

    const boot = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: {
        username: "owner", name: "The Owner",
        email: "owner@example.test", password: "correct-horse-battery-staple",
      },
    });
    [sid, csrf] = cookiesFrom(boot);
    adminId = boot.json().user.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  const create = (over: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST", url: "/api/v1/users", headers: auth(),
      payload: {
        username: "priya", name: "Priya Nair", email: "priya@example.test",
        role: "contributor", password: "another-long-password-here", ...over,
      },
    });

  it("adds a user who can then sign in", async () => {
    const res = await create();
    expect(res.statusCode).toBe(201);
    expect(res.json().user.role).toBe("contributor");
    expect(res.json().user).not.toHaveProperty("password_hash");

    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: "priya", password: "another-long-password-here" },
    });
    expect(login.statusCode).toBe(200);
  });

  it("refuses a duplicate username, whatever the casing", async () => {
    const res = await create({ username: "PRIYA", email: "other@example.test" });
    expect(res.statusCode).toBe(409);
  });

  it("refuses a weak password", async () => {
    const res = await create({ username: "weak", email: "weak@example.test", password: "short" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/at least 12/);
  });

  it("will not let an administrator disable their own account", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/api/v1/users/${adminId}`, headers: auth(),
      payload: { disabled: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/your own account/i);
  });

  it("will not let an administrator remove their own admin role", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/api/v1/users/${adminId}`, headers: auth(),
      payload: { role: "readonly" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/your own administrator role/i);
  });

  it("never lets the number of enabled administrators reach zero", async () => {
    // With one administrator, both routes to zero are refused, and that is the
    // invariant that matters — not which message comes back.
    const count = async (): Promise<number> => {
      const { rows } = await query<{ n: number }>(
        "select count(*) as n from users where role = 'admin' and disabled = 0",
      );
      return rows[0]!.n;
    };
    expect(await count()).toBe(1);

    for (const payload of [{ role: "readonly" }, { disabled: true }]) {
      const res = await app.inject({
        method: "PATCH", url: `/api/v1/users/${adminId}`, headers: auth(), payload,
      });
      expect(res.statusCode).toBe(400);
    }
    expect(await count()).toBe(1);

    // With a second administrator, demoting one of them is allowed.
    const second = await create({
      username: "second", name: "Second Admin", email: "second@example.test", role: "admin",
    });
    expect(second.statusCode).toBe(201);
    expect(await count()).toBe(2);

    const demote = await app.inject({
      method: "PATCH", url: `/api/v1/users/${second.json().user.id}`, headers: auth(),
      payload: { role: "auditor" },
    });
    expect(demote.statusCode).toBe(200);
    expect(await count()).toBe(1);
  });

  it("signs a disabled user out immediately rather than waiting for their cookie to expire", async () => {
    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: "priya", password: "another-long-password-here" },
    });
    const [pSid, pCsrf] = cookiesFrom(login);
    const asPriya = { cookie: `offset_sid=${pSid}; offset_csrf=${pCsrf}` };

    expect((await app.inject({ url: "/api/v1/controls", headers: asPriya })).statusCode).toBe(200);

    const { rows } = await query<{ id: string }>("select id from users where username = 'priya'");
    const res = await app.inject({
      method: "PATCH", url: `/api/v1/users/${rows[0]!.id}`, headers: auth(),
      payload: { disabled: true },
    });
    expect(res.statusCode).toBe(200);

    // The session was destroyed, not merely marked.
    expect((await app.inject({ url: "/api/v1/controls", headers: asPriya })).statusCode).toBe(401);
  });

  it("resets a password, clears the lockout, and ends that user's sessions", async () => {
    const { rows } = await query<{ id: string }>("select id from users where username = 'priya'");
    const id = rows[0]!.id;
    await query("update users set disabled = 0, failed_logins = 5, locked_until = $1 where id = $2", [
      new Date(Date.now() + 900_000).toISOString(),
      id,
    ]);

    const res = await app.inject({
      method: "POST", url: `/api/v1/users/${id}/password`, headers: auth(),
      payload: { password: "a-brand-new-long-password" },
    });
    expect(res.statusCode).toBe(200);

    const after = await query<{ failed_logins: number; locked_until: string | null }>(
      "select failed_logins, locked_until from users where id = $1",
      [id],
    );
    expect(after.rows[0]!.failed_logins).toBe(0);
    expect(after.rows[0]!.locked_until).toBeNull();

    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: "priya", password: "a-brand-new-long-password" },
    });
    expect(login.statusCode).toBe(200);
  });

  it("keeps a disabled user's audit history rather than deleting the account", async () => {
    const { rows } = await query<{ n: number }>(
      "select count(*) as n from audit_log where action in ('User added','User updated','Password reset')",
    );
    expect(rows[0]!.n).toBeGreaterThan(0);
  });

  it("is closed to everyone but administrators", async () => {
    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: "priya", password: "a-brand-new-long-password" },
    });
    const [pSid, pCsrf] = cookiesFrom(login);
    const asPriya = { cookie: `offset_sid=${pSid}; offset_csrf=${pCsrf}`, "x-csrf-token": pCsrf };

    expect((await app.inject({ url: "/api/v1/users", headers: asPriya })).statusCode).toBe(403);
    expect(
      (await app.inject({
        method: "POST", url: "/api/v1/users", headers: asPriya,
        payload: {
          username: "sneaky", name: "Sneaky", email: "s@example.test",
          role: "admin", password: "another-long-password-here",
        },
      })).statusCode,
    ).toBe(403);
    expect((await app.inject({ url: "/api/v1/users" })).statusCode).toBe(401);
  });

  it("refuses a user write without a CSRF token", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/users", headers: read(),
      payload: {
        username: "nocsrf", name: "No CSRF", email: "n@example.test",
        role: "readonly", password: "another-long-password-here",
      },
    });
    expect(res.statusCode).toBe(403);
  });
});
