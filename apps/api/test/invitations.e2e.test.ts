import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";

/**
 * Inviting a person instead of giving them a password.
 *
 * The point is that nobody but the person ever knows their password: not the
 * administrator who added them, not the product's logs, not the audit trail.
 * So most of this is about what the invitation must not become: a way in that
 * works twice, outlives its three days, opens anything but the page that
 * chooses a password, or leaves behind an account nobody can use.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

const ADMIN_PASSWORD = "correct-horse-battery-staple";
const CHOSEN = "a-password-only-kavita-knows-1";
/** Fenced on both sides, as in the reset tests: a Message-ID can contain a run that fits. */
const ONE_TIME = /(?<![\w-])[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}(?![\w-])/;

interface Mail { to: string[]; raw: string }

maybe("invitations", () => {
  let app: FastifyInstance;
  const inbox: Mail[] = [];
  let smtpServer: { close: (cb: () => void) => void } | undefined;
  let smtpPort = 0;
  let ip = 0;
  const nextIp = () => `10.1.0.${++ip}`;

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

  const mailFor = async (address: string, count: number, timeoutMs = 8000): Promise<Mail[]> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = inbox.filter((m) => m.to.includes(address));
      if (found.length >= count || Date.now() > deadline) return found;
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const oneTimeIn = (mail: Mail | undefined): string => {
    const m = mail ? ONE_TIME.exec(mail.raw) : null;
    if (!m) throw new Error("no one-time password in the email");
    return m[0];
  };

  const setMail = (enabled: boolean, port = smtpPort) =>
    app.inject({
      method: "PUT", url: "/api/v1/settings/smtp", headers: headers(adminSession),
      payload: {
        provider: "custom", enabled, host: "127.0.0.1", port, secure: false,
        username: "", fromAddress: "offset@example.test", fromName: "Offset", rejectUnauthorized: false,
      },
    });
  const invite = (username: string, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST", url: "/api/v1/users", headers: headers(adminSession),
      payload: {
        username, name: "Kavita Rao", email: `${username}@example.test`, role: "contributor", invite: true,
        ...extra,
      },
    });
  const exists = async (username: string) =>
    ((await query("select 1 from users where username = $1", [username])).rows.length) > 0;

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
    smtpServer = server;
    smtpPort = (server.server.address() as AddressInfo).port;

    app = await buildApp();
    await app.ready();
    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "admin", name: "Aisha Admin", email: "admin@example.test", password: ADMIN_PASSWORD },
    });
    adminSession = cookies(boot);
  }, 60_000);

  beforeEach(async () => {
    inbox.length = 0;
    await setMail(true);
    await query("delete from password_resets");
    await query("delete from users where username <> 'admin'");
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((r) => (smtpServer ? smtpServer.close(() => r()) : r()));
    await pool.end();
  });

  it("emails a one-time password and never shows it to the administrator", async () => {
    const res = await invite("kavita");
    expect(res.statusCode).toBe(201);
    expect(res.json().invited).toBe(true);
    // Nothing in the reply, the user list or the audit trail carries it.
    const [mail] = await mailFor("kavita@example.test", 1);
    const oneTime = oneTimeIn(mail);
    expect(JSON.stringify(res.json())).not.toContain(oneTime);
    const listed = (await app.inject({ url: "/api/v1/users", headers: headers(adminSession) })).body;
    expect(listed).not.toContain(oneTime);
    const trail = (await query<{ after: string | null }>("select after from audit_log")).rows
      .map((r) => r.after ?? "").join(" ");
    expect(trail).not.toContain(oneTime);

    expect(mail!.raw).toMatch(/one-time password/i);
    expect(res.json().user.invited).toBe(1);
    const audited = (await query<{ action: string }>("select action from audit_log")).rows.map((r) => r.action);
    expect(audited).toContain("User invited");
  });

  it("lets them in once, to a page that only chooses a password", async () => {
    await invite("kavita");
    const oneTime = oneTimeIn((await mailFor("kavita@example.test", 1))[0]);

    const res = await login("kavita", oneTime);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.mustChangePassword).toBe(true);
    const session = cookies(res);

    // Everything but choosing a password is closed.
    expect((await app.inject({ url: "/api/v1/controls", headers: headers(session) })).statusCode).toBe(403);

    // Spent on first use, even before they have chosen anything.
    expect((await login("kavita", oneTime)).statusCode).toBe(401);

    // They choose. From then on only their own password works.
    const chosen = await app.inject({
      method: "POST", url: "/api/v1/auth/password", headers: headers(session),
      payload: { newPassword: CHOSEN },
    });
    expect(chosen.statusCode).toBe(200);
    const again = await login("kavita", CHOSEN);
    expect(again.statusCode).toBe(200);
    expect(again.json().user.mustChangePassword).toBeUndefined();
    expect((await login("kavita", oneTime)).statusCode).toBe(401);
  });

  it("does not let a guess or a stale password in", async () => {
    await invite("kavita");
    expect((await login("kavita", "abcd-efgh-jkmn-pqrs")).statusCode).toBe(401);
    // The random password the row holds is not something anybody can sign in with.
    expect((await login("kavita", "")).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("stops working after three days", async () => {
    await invite("kavita");
    const oneTime = oneTimeIn((await mailFor("kavita@example.test", 1))[0]);
    const row = (await query<{ expires_at: string; created_at: string }>(
      "select expires_at, created_at from password_resets",
    )).rows[0]!;
    const lifetimeHours = (Date.parse(row.expires_at) - Date.parse(row.created_at)) / 3_600_000;
    expect(lifetimeHours).toBeGreaterThan(71);
    expect(lifetimeHours).toBeLessThan(73);

    await query("update password_resets set expires_at = '2000-01-01T00:00:00.000Z'");
    expect((await login("kavita", oneTime)).statusCode).toBe(401);
  });

  it("refuses to invite when email is not set up, and creates nothing", async () => {
    await setMail(false);
    const res = await invite("kavita");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/email is not set up/i);
    expect(await exists("kavita")).toBe(false);
  });

  it("takes the account back when the email cannot be sent", async () => {
    // A port nothing listens on: the account must not be left behind with no way in.
    await setMail(true, 1);
    const res = await invite("kavita");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/nothing was created/i);
    expect(await exists("kavita")).toBe(false);
    expect((await query("select 1 from password_resets")).rows).toHaveLength(0);
  });

  it("is invitation or password, never both and never neither", async () => {
    const both = await invite("kavita", { password: "another-long-password-here" });
    expect(both.statusCode).toBe(400);
    const neither = await app.inject({
      method: "POST", url: "/api/v1/users", headers: headers(adminSession),
      payload: { username: "kavita", name: "Kavita Rao", email: "kavita@example.test", role: "contributor" },
    });
    expect(neither.statusCode).toBe(400);
    expect(await exists("kavita")).toBe(false);
  });

  it("still lets an administrator choose a password the old way", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/users", headers: headers(adminSession),
      payload: {
        username: "kavita", name: "Kavita Rao", email: "kavita@example.test",
        role: "contributor", password: "another-long-password-here",
      },
    });
    expect(res.statusCode).toBe(201);
    expect((await login("kavita", "another-long-password-here")).statusCode).toBe(200);
  });

  it("sends a fresh one on request, cancels the old one, and stops once they have signed in", async () => {
    await invite("kavita");
    const first = oneTimeIn((await mailFor("kavita@example.test", 1))[0]);

    const id = (await query<{ id: string }>("select id from users where username = 'kavita'")).rows[0]!.id;
    const again = await app.inject({ method: "POST", url: `/api/v1/users/${id}/invite`, headers: headers(adminSession) });
    expect(again.statusCode).toBe(200);
    const second = oneTimeIn((await mailFor("kavita@example.test", 2))[1]);
    expect(second).not.toBe(first);
    expect((await login("kavita", first)).statusCode).toBe(401);

    expect((await login("kavita", second)).statusCode).toBe(200);
    const late = await app.inject({ method: "POST", url: `/api/v1/users/${id}/invite`, headers: headers(adminSession) });
    expect(late.statusCode).toBe(400);
    expect(late.json().error).toMatch(/already signed in/i);
  });

  it("works for every role, but a password reset still works only for administrators", async () => {
    for (const role of ["auditor", "readonly"]) {
      const username = `person-${role}`;
      const res = await invite(username, { role });
      expect(res.statusCode).toBe(201);
      const oneTime = oneTimeIn((await mailFor(`${username}@example.test`, 1))[0]);
      expect((await login(username, oneTime)).statusCode).toBe(200);
    }

    // A reset-kind password, issued by hand for a contributor, gets nobody in.
    await invite("kavita");
    await query("delete from password_resets");
    const { issueTemporaryPassword } = await import("../src/auth/temporary.js");
    const id = (await query<{ id: string }>("select id from users where username = 'kavita'")).rows[0]!.id;
    const reset = await issueTemporaryPassword(id, null, "reset");
    expect((await login("kavita", reset)).statusCode).toBe(401);
  });
});
