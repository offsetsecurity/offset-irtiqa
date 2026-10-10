import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";

/**
 * "Forgot password?" for administrators.
 *
 * The feature is a way into the product that needs no password, so most of
 * this is about what it must not do: tell a stranger which accounts exist,
 * lock a real administrator out, work twice, outlive thirty minutes, work for
 * anyone but an administrator, or open anything but the page that chooses a
 * new password.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

const OLD_PASSWORD = "correct-horse-battery-staple";
/**
 * Fenced on both sides. Without that it also matched inside the email's
 * Message-ID, which is a UUID: any sixteen hex digits in a row with no 0 or 1
 * fit the alphabet, about one email in five, and the test then signed in with
 * a piece of a header and failed at random.
 */
const TEMPORARY = /(?<![\w-])[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}(?![\w-])/;

interface Mail { to: string[]; raw: string }

maybe("password reset", { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  const inbox: Mail[] = [];
  let smtp: { close: (cb: () => void) => void } | undefined;
  let ip = 0;
  /** Each request from its own address, so the per-address limit is tested only where meant. */
  const nextIp = () => `10.0.0.${++ip}`;

  const cookies = (res: LightMyRequestResponse): string => {
    const jar: string[] = [];
    let csrf = "";
    for (const line of (res.headers["set-cookie"] as string[] | undefined) ?? []) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(line);
      if (m) jar.push(`${m[1]}=${m[2]}`);
      if (m?.[1] === "offset_csrf") csrf = m[2]!;
    }
    return JSON.stringify({ cookie: jar.join("; "), csrf });
  };
  const headers = (session: string) => {
    const { cookie, csrf } = JSON.parse(session) as { cookie: string; csrf: string };
    return { cookie, "x-csrf-token": csrf };
  };

  const login = (username: string, password: string) =>
    app.inject({ method: "POST", url: "/api/v1/auth/login", remoteAddress: nextIp(), payload: { username, password } });

  const forgot = (identifier: string, remoteAddress = nextIp()) =>
    app.inject({ method: "POST", url: "/api/v1/auth/forgot", remoteAddress, payload: { identifier } });

  /**
   * The newest temporary password emailed to `address` after `since` mails had
   * arrived. Emails are sent after the reply, and one from an earlier request
   * can land late, so the count at the moment of asking is the fence.
   */
  async function newTemporary(address: string, since: number, timeoutMs = 30_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const fresh = inbox.slice(since).filter((m) => m.to.includes(address) && TEMPORARY.test(m.raw));
      if (fresh.length) return temporaryIn(fresh[fresh.length - 1]);
      if (Date.now() > deadline) throw new Error("no new temporary password arrived");
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** The email is sent after the reply, so wait for it. */
  async function mailsFor(address: string, count: number, timeoutMs = 30_000): Promise<Mail[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = inbox.filter((m) => m.to.includes(address));
      if (found.length >= count || Date.now() > deadline) return found;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const temporaryIn = (mail: Mail | undefined): string => {
    const m = mail ? TEMPORARY.exec(mail.raw) : null;
    if (!m) throw new Error("no temporary password in the email");
    return m[0];
  };
  const settle = () => new Promise((r) => setTimeout(r, 1500));

  let adminSession = "";

  beforeAll(async () => {
    await migrate();
    for (const t of ["audit_log", "password_resets", "sessions", "users", "settings"]) {
      await query(`delete from ${t}`);
    }

    const { SMTPServer } = await import("smtp-server");
    const server = new SMTPServer({
      authOptional: true,
      onData(stream, session, callback) {
        let raw = "";
        stream.on("data", (c: Buffer) => { raw += c.toString("utf8"); });
        stream.on("end", () => {
          inbox.push({ to: session.envelope.rcptTo.map((r) => r.address.toLowerCase()), raw });
          callback();
        });
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    smtp = server;
    const port = (server.server.address() as AddressInfo).port;

    app = await buildApp();
    await app.ready();

    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "admin", name: "Aisha Admin", email: "admin@example.test", password: OLD_PASSWORD },
    });
    adminSession = cookies(boot);

    await app.inject({
      method: "PUT", url: "/api/v1/settings/smtp", headers: headers(adminSession),
      payload: {
        provider: "custom", enabled: true, host: "127.0.0.1", port, secure: false,
        username: "", fromAddress: "irtiqa@example.test", fromName: "Offset", rejectUnauthorized: false,
      },
    });
    await app.inject({
      method: "POST", url: "/api/v1/users", headers: headers(adminSession),
      payload: { username: "priya", name: "Priya", email: "priya@example.test", role: "contributor", password: "another-long-password-here" },
    });
    await settle();
  }, 60_000);

  beforeEach(async () => {
    // Let anything still being sent from the previous test finish first.
    await settle();
    inbox.length = 0;
    await query("delete from password_resets");
    await query("update users set failed_logins = 0, locked_until = null");
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((r) => (smtp ? smtp.close(() => r()) : r()));
    await pool.end();
  });

  it("answers every request with the same words", async () => {
    const replies = await Promise.all(
      ["admin", "ADMIN@example.test", "priya", "nobody-at-all", "priya@example.test"].map((id) => forgot(id)),
    );
    for (const r of replies) expect(r.statusCode).toBe(200);
    expect(new Set(replies.map((r) => r.json().message)).size).toBe(1);

    // Only the administrator, once by name and once by address, heard anything.
    await settle();
    expect((await mailsFor("admin@example.test", 2)).length).toBe(2);
    expect(inbox.filter((m) => m.to.includes("priya@example.test"))).toHaveLength(0);
  });

  it("emails a temporary password that only opens the page to choose a new one", async () => {
    await forgot("admin");
    const [mail] = await mailsFor("admin@example.test", 1);
    expect(mail!.raw).toMatch(/temporary password/i);
    const temporary = temporaryIn(mail);

    const res = await login("admin", temporary);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.mustChangePassword).toBe(true);
    const session = cookies(res);

    // Everything but choosing a password is closed.
    expect((await app.inject({ url: "/api/v1/controls", headers: headers(session) })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/v1/users", headers: headers(session) })).statusCode).toBe(403);
    expect((await app.inject({ url: "/api/v1/auth/me", headers: headers(session) })).json().user.mustChangePassword).toBe(true);

    // And the temporary password is spent.
    expect((await login("admin", temporary)).statusCode).toBe(401);
  });

  it("leaves the real password working, so a stranger cannot lock the administrator out", async () => {
    await forgot("admin");
    await mailsFor("admin@example.test", 1);
    const res = await login("admin", OLD_PASSWORD);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.mustChangePassword).toBeUndefined();
  });

  it("honours only the newest email", async () => {
    await forgot("admin");
    const first = temporaryIn((await mailsFor("admin@example.test", 1))[0]);
    await forgot("admin");
    const second = temporaryIn((await mailsFor("admin@example.test", 2))[1]);

    expect((await login("admin", first)).statusCode).toBe(401);
    expect((await login("admin", second)).statusCode).toBe(200);
  });

  it("stops working after thirty minutes", async () => {
    await forgot("admin");
    const temporary = temporaryIn((await mailsFor("admin@example.test", 1))[0]);
    await query("update password_resets set expires_at = '2000-01-01T00:00:00.000Z'");
    expect((await login("admin", temporary)).statusCode).toBe(401);
  });

  it("sends no more than three an hour to one account", async () => {
    for (let i = 0; i < 5; i++) await forgot("admin");
    await new Promise((r) => setTimeout(r, 4000));
    expect((await mailsFor("admin@example.test", 5, 2000)).length).toBe(3);
  }, 20_000);

  it("limits one address to five requests in fifteen minutes", async () => {
    const from = nextIp();
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await forgot("nobody", from)).statusCode);
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes.slice(5)).toEqual([429, 429]);
  });

  it("is for administrators only", async () => {
    // Even a reset row planted for a contributor does not sign them in.
    const { hashPassword } = await import("../src/auth/password.js");
    const { rows } = await query<{ id: string }>("select id from users where username = 'priya'");
    await query(
      `insert into password_resets (id, user_id, password_hash, expires_at)
       values ('00000000-0000-4000-8000-000000000001', $1, $2, '2999-01-01T00:00:00.000Z')`,
      [rows[0]!.id, await hashPassword("aaaa-bbbb-cccc-dddd")],
    );
    expect((await login("priya", "aaaa-bbbb-cccc-dddd")).statusCode).toBe(401);
  });

  it("gets a locked-out administrator back in, and the new password replaces the old", async () => {
    for (let i = 0; i < 5; i++) await login("admin", "wrong-password-entirely");
    expect((await login("admin", OLD_PASSWORD)).statusCode).toBe(401); // locked

    // A session opened earlier, which choosing a new password must end.
    const elsewhere = adminSession;

    const mark = inbox.length;
    await forgot("admin");
    const temporary = await newTemporary("admin@example.test", mark);
    const signedIn = await login("admin", temporary);
    expect(signedIn.statusCode).toBe(200);
    const session = cookies(signedIn);
    const choose = (newPassword: string) => app.inject({
      method: "POST", url: "/api/v1/auth/password", headers: headers(session), payload: { newPassword },
    });

    expect((await choose("short")).statusCode).toBe(400);
    expect((await choose(OLD_PASSWORD)).json().error).toMatch(/different/);

    const chosen = await choose("a brand new passphrase for aisha");
    expect(chosen.statusCode).toBe(200);
    expect(chosen.json().user.mustChangePassword).toBeUndefined();

    // This session carries on, and can now reach everything.
    expect((await app.inject({ url: "/api/v1/controls", headers: headers(session) })).statusCode).toBe(200);
    // Every other one has ended.
    expect((await app.inject({ url: "/api/v1/auth/me", headers: headers(elsewhere) })).statusCode).toBe(401);

    expect((await login("admin", OLD_PASSWORD)).statusCode).toBe(401);
    expect((await login("admin", temporary)).statusCode).toBe(401);
    const fresh = await login("admin", "a brand new passphrase for aisha");
    expect(fresh.statusCode).toBe(200);
    adminSession = cookies(fresh);

    // Told about it, in case it was not them.
    const notices = await mailsFor("admin@example.test", 2);
    expect(notices.some((m) => /password was changed/i.test(m.raw))).toBe(true);
  });

  it("asks for the current password when changing it from the top bar", async () => {
    const change = (body: Record<string, string>) => app.inject({
      method: "POST", url: "/api/v1/auth/password", headers: headers(adminSession), payload: body,
    });
    expect((await change({ newPassword: "yet another long passphrase" })).statusCode).toBe(400);
    expect((await change({ currentPassword: "not it at all", newPassword: "yet another long passphrase" })).json().error)
      .toMatch(/current password/);
    expect((await change({ currentPassword: "a brand new passphrase for aisha", newPassword: "yet another long passphrase" })).statusCode)
      .toBe(200);
  });

  it("issues nothing usable when the email cannot be sent", async () => {
    await app.inject({
      method: "PUT", url: "/api/v1/settings/smtp", headers: headers(adminSession),
      payload: {
        provider: "custom", enabled: true, host: "127.0.0.1", port: 1, secure: false,
        username: "", fromAddress: "irtiqa@example.test", fromName: "Offset", rejectUnauthorized: false,
      },
    });
    await forgot("admin");
    await settle();
    await new Promise((r) => setTimeout(r, 3000));
    const { rows } = await query<{ n: number }>("select count(*) as n from password_resets where used_at is null");
    expect(rows[0]!.n).toBe(0);
  }, 20_000);

  it("can be issued at the server when email is no help", async () => {
    const run = spawnSync(process.execPath, ["--import", "tsx", "src/admin/reset-password.ts", "admin"], {
      env: process.env, encoding: "utf8", timeout: 60_000,
    });
    expect(run.status, run.stderr).toBe(0);
    const temporary = TEMPORARY.exec(run.stdout)?.[0];
    expect(temporary).toBeTruthy();

    const res = await login("admin", temporary!);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.mustChangePassword).toBe(true);

    const refused = spawnSync(process.execPath, ["--import", "tsx", "src/admin/reset-password.ts", "priya"], {
      env: process.env, encoding: "utf8", timeout: 60_000,
    });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/not an administrator/);
  }, 120_000);
});
