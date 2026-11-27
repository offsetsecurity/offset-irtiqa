import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { seedControls } from "../src/db/seed.js";
import { pool, query } from "../src/db/pool.js";
import { resetAddressLimits } from "../src/auth/address-limit.js";
import { issueTemporaryPassword } from "../src/auth/temporary.js";

/**
 * Findings of the go-live gate for 0.3.0 (27 Nov 2026) about signing in, one
 * test each; the same fixes and tests as Offset Assure's (F1, F2, F7, F8):
 *
 *   G4  "/%61pi/..." skipped the choose-a-new-password guard
 *   G3  setting a person's password left an old invitation usable
 *   G7  two first-run requests could both create an administrator
 *   G8  sign-out did not check the CSRF token
 *
 * G10 (sign-in timing) is counted in signin-timing.e2e.test.ts.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

const PASSWORD = "correct-horse-battery-staple";

maybe("sign-in findings of the go-live gate", () => {
  let app: FastifyInstance;
  let admin = { sid: "", csrf: "" };
  let n = 0;

  const cookiesOf = (res: { headers: Record<string, unknown> }) => {
    const out = { sid: "", csrf: "" };
    for (const c of [res.headers["set-cookie"] ?? []].flat() as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(c);
      if (m?.[1] === "offset_sid") out.sid = m[2]!;
      if (m?.[1] === "offset_csrf") out.csrf = m[2]!;
    }
    return out;
  };
  const browser = (s = admin) => ({ cookie: `offset_sid=${s.sid}; offset_csrf=${s.csrf}`, "x-csrf-token": s.csrf });
  const login = (username: string, password: string) =>
    app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  const person = async (role = "contributor") => {
    const username = `r${++n}x${Math.random().toString(36).slice(2, 6)}`;
    const res = await app.inject({
      method: "POST", url: "/api/v1/users", headers: browser(),
      payload: { username, name: `Reviewer ${n}`, email: `${username}@example.test`, role, password: PASSWORD },
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (await query<{ id: string }>("select id from users where username = $1", [username])).rows[0]!.id;
    return { username, id };
  };

  beforeAll(async () => {
    await migrate();
    for (const t of ["audit_log", "sessions", "users"]) await query(`delete from ${t}`);
    await query("delete from controls");
    await seedControls();
    resetAddressLimits();
    app = await buildApp();
    await app.ready();
    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "keeper", name: "The Keeper", email: "keeper@example.test", password: PASSWORD },
    });
    expect(boot.statusCode).toBe(201);
    admin = cookiesOf(boot);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("G4: a session opened with a temporary password reaches nothing but choosing a password, however the address is written", async () => {
    resetAddressLimits();
    const p = await person();
    const temp = await issueTemporaryPassword(p.id, null, "invite");
    const signed = await login(p.username, temp);
    expect(signed.statusCode).toBe(200);
    const s = cookiesOf(signed);
    for (const url of ["/api/v1/controls", "/%61pi/v1/controls", "/api/v1/%63ontrols"]) {
      const res = await app.inject({ url, headers: browser(s) });
      expect([403, 404], `${url} answered ${res.statusCode}: ${res.body.slice(0, 80)}`).toContain(res.statusCode);
      expect(res.body).not.toContain('"controls"');
    }
    // Encoded twice, the router sees "/%61pi/..." which is no route at all: the web page, never data.
    const twice = await app.inject({ url: "/%2561pi/v1/controls", headers: browser(s) });
    expect(twice.body).not.toContain('"controls"');
  });

  it("G3: setting a person's password ends an invitation that was still outstanding", async () => {
    resetAddressLimits();
    const p = await person();
    const invite = await issueTemporaryPassword(p.id, null, "invite");
    const set = await app.inject({
      method: "POST", url: `/api/v1/users/${p.id}/password`, headers: browser(), payload: { password: "an-entirely-new-passphrase-77" },
    });
    expect(set.statusCode, set.body).toBe(200);
    expect((await login(p.username, invite)).statusCode).toBe(401);
    expect((await login(p.username, "an-entirely-new-passphrase-77")).statusCode).toBe(200);
  });

  it("G7: two first-run requests at the same moment make one administrator, not two", async () => {
    const fresh = await buildApp();
    await fresh.ready();
    const saved = (await query<{ id: string }>("select id from users")).rows.map((r) => r.id);
    try {
      await query("delete from sessions");
      await query("delete from users");
      const make = (name: string) => fresh.inject({
        method: "POST", url: "/api/v1/auth/bootstrap",
        payload: { username: name, name, email: `${name}@example.test`, password: PASSWORD },
      });
      const results = await Promise.all([make("first"), make("second"), make("third")]);
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
      expect((await query<{ n: number }>("select count(*) as n from users")).rows[0]!.n).toBe(1);
    } finally {
      await fresh.close();
      expect(saved.length).toBeGreaterThan(0); // the earlier people are gone; the next tests make their own
      await query("delete from sessions");
      await query("delete from users");
      const again = await buildApp();
      await again.ready();
      const boot = await again.inject({
        method: "POST", url: "/api/v1/auth/bootstrap",
        payload: { username: "keeper", name: "The Keeper", email: "keeper@example.test", password: PASSWORD },
      });
      admin = cookiesOf(boot);
      await again.close();
    }
  });

  it("G8: signing out needs the CSRF token, so another site cannot sign a person out", async () => {
    resetAddressLimits();
    const p = await person();
    const s = cookiesOf(await login(p.username, PASSWORD));
    const without = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie: `offset_sid=${s.sid}; offset_csrf=${s.csrf}` } });
    expect(without.statusCode).toBe(403);
    const withToken = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: browser(s) });
    expect(withToken.statusCode).toBe(200);
  });
});
