import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";

/**
 * Outgoing email.
 *
 * A real SMTP server runs for these tests, on a random free port. Asserting
 * that nodemailer was called would prove nothing about whether a message ever
 * leaves the process — and "the test button says it worked" is exactly the
 * claim a customer will hold us to.
 *
 * The rest is the awkward parts: the password must never come back out, saving
 * an unrelated field must not wipe it, and turning email on while it cannot
 * possibly work must be refused while somebody is still looking at the screen.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

interface Received {
  from: string;
  to: string[];
  body: string;
}

maybe("outgoing email", () => {
  let app: FastifyInstance;
  let server: SMTPServer;
  let port = 0;
  let sid = "";
  let csrf = "";
  const inbox: Received[] = [];

  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });

  const cookiesFrom = (res: { headers: Record<string, unknown> }): [string, string] => {
    let s = "", c = "";
    for (const raw of res.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(raw);
      if (m?.[1] === "offset_sid") s = m[2]!;
      if (m?.[1] === "offset_csrf") c = m[2]!;
    }
    return [s, c];
  };

  const put = (payload: Record<string, unknown>) =>
    app.inject({ method: "PUT", url: "/api/v1/settings/smtp", headers: auth(), payload });

  const get = () => app.inject({ url: "/api/v1/settings/smtp", headers: auth() });

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      // A self-signed certificate is not worth generating here; the TLS path is
      // nodemailer's, not ours.
      disabledCommands: ["STARTTLS"],
      onData(stream, _session, callback) {
        let body = "";
        stream.on("data", (chunk: Buffer) => (body += String(chunk)));
        stream.on("end", () => {
          inbox.push({
            from: _session.envelope.mailFrom ? _session.envelope.mailFrom.address : "",
            to: _session.envelope.rcptTo.map((r: { address: string }) => r.address),
            body,
          });
          callback();
        });
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.server.address() as AddressInfo).port;

    await migrate();
    for (const t of ["audit_log", "sessions", "users"]) await query(`delete from ${t}`);
    await query("delete from settings where key = 'smtp'");

    app = await buildApp();
    await app.ready();

    const boot = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: {
        username: "mailadmin", name: "Mail Admin",
        email: "mailadmin@example.test", password: "correct-horse-battery-staple",
      },
    });
    [sid, csrf] = cookiesFrom(boot);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const working = () => ({
    enabled: true,
    host: "127.0.0.1",
    port,
    secure: false,
    username: "",
    fromAddress: "grc@example.test",
    fromName: "Offset",
    rejectUnauthorized: false,
  });

  it("starts with email off and nothing configured", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json().smtp).toMatchObject({ enabled: false, host: "", hasPassword: false });
  });

  it("refuses to turn email on when it could not possibly send", async () => {
    const noHost = await put({ ...working(), host: "" });
    expect(noHost.statusCode).toBe(400);
    expect(noHost.json().error).toMatch(/mail server/i);

    const noFrom = await put({ ...working(), fromAddress: "" });
    expect(noFrom.statusCode).toBe(400);
    expect(noFrom.json().error).toMatch(/from/i);

    // A username with no password would fail at every send, silently.
    const halfAuth = await put({ ...working(), username: "someone" });
    expect(halfAuth.statusCode).toBe(400);
    expect(halfAuth.json().error).toMatch(/password/i);
  });

  it("saves settings that can send", async () => {
    const res = await put(working());
    expect(res.statusCode).toBe(200);
    expect(res.json().smtp).toMatchObject({ enabled: true, host: "127.0.0.1", port });
  });

  it("never returns the password", async () => {
    const saved = await put({ ...working(), username: "someone", password: "a-real-secret" });
    expect(saved.statusCode).toBe(200);

    const body = JSON.stringify(saved.json()) + JSON.stringify((await get()).json());
    expect(body).not.toContain("a-real-secret");
    expect(body).not.toContain("password\":\"");
    expect(saved.json().smtp.hasPassword).toBe(true);
  });

  it("stores the password encrypted, not as text", async () => {
    const { rows } = await query<{ value: string }>(
      "select value from settings where key = 'smtp'",
    );
    expect(rows[0]!.value).not.toContain("a-real-secret");
    expect(rows[0]!.value).toContain("v1:");
  });

  it("keeps the stored password when the form does not send one", async () => {
    // The single most likely way to break this feature: change the port, lose
    // the password, and only find out when the next night's email fails.
    const res = await put({ ...working(), username: "someone", port });
    expect(res.statusCode).toBe(200);
    expect(res.json().smtp.hasPassword).toBe(true);
  });

  it("clears the password when the form sends an empty one", async () => {
    const res = await put({ ...working(), username: "", password: "" });
    expect(res.statusCode).toBe(200);
    expect(res.json().smtp.hasPassword).toBe(false);
  });

  it("actually delivers a test message", async () => {
    await put(working());
    const before = inbox.length;

    const res = await app.inject({
      method: "POST", url: "/api/v1/settings/smtp/test", headers: auth(),
      payload: { to: "someone@example.test" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    expect(inbox.length).toBe(before + 1);
    const message = inbox.at(-1)!;
    expect(message.to).toEqual(["someone@example.test"]);
    expect(message.from).toBe("grc@example.test");
    expect(message.body).toContain("test");
  });

  it("explains a mail server that is not there, rather than hanging", async () => {
    // Port 1 is reserved and nothing listens on it.
    await put({ ...working(), enabled: false, port: 1 });
    const res = await app.inject({
      method: "POST", url: "/api/v1/settings/smtp/test", headers: auth(),
      payload: { to: "someone@example.test" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
    expect(res.json().stage).toBe("connect");
    expect(res.json().reason).toBeTruthy();
  }, 40_000);

  it("refuses an address that is not one", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/settings/smtp/test", headers: auth(),
      payload: { to: "not-an-address" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("fills in Resend's own settings so nobody has to know them", async () => {
    const res = await put({
      provider: "resend",
      enabled: false,
      // Deliberately wrong. A preset is the authority, not the form.
      host: "wrong.example.com",
      port: 25,
      secure: false,
      username: "not-resend",
      password: "re_test_key",
      fromAddress: "grc@example.test",
      fromName: "Offset",
      rejectUnauthorized: false,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().smtp).toMatchObject({
      provider: "resend",
      host: "smtp.resend.com",
      port: 465,
      secure: true,
      username: "resend",
      // A hosted provider always has a public certificate, so this is not
      // something a form should be able to switch off.
      rejectUnauthorized: true,
      hasPassword: true,
    });
  });

  it("asks for an API key, not a password, when a provider is chosen", async () => {
    const res = await put({
      provider: "resend",
      enabled: true,
      secure: false,
      username: "",
      password: "",
      fromAddress: "grc@example.test",
      fromName: "Offset",
      rejectUnauthorized: true,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Resend API key/i);
  });

  it("forgets the old secret when the provider changes", async () => {
    // A mail password is not an API key. Carrying it across would fail at the
    // far end in a way nobody could read.
    const toResend = await put({
      provider: "resend", enabled: false, secure: false,
      username: "", password: "re_test_key",
      fromAddress: "grc@example.test", fromName: "Offset", rejectUnauthorized: true,
    });
    expect(toResend.json().smtp.hasPassword).toBe(true);

    const toCustom = await put({
      provider: "custom", enabled: false, host: "127.0.0.1", port, secure: false,
      username: "", fromAddress: "grc@example.test", fromName: "Offset",
      rejectUnauthorized: false,
    });
    expect(toCustom.statusCode).toBe(200);
    expect(toCustom.json().smtp.hasPassword).toBe(false);
  });

  it("is closed to everyone but administrators", async () => {
    await app.inject({
      method: "POST", url: "/api/v1/users", headers: auth(),
      payload: {
        username: "reader", name: "Reader", email: "reader@example.test",
        role: "readonly", password: "another-long-password-here",
      },
    });
    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: "reader", password: "another-long-password-here" },
    });
    const [rSid, rCsrf] = cookiesFrom(login);
    const asReader = { cookie: `offset_sid=${rSid}; offset_csrf=${rCsrf}`, "x-csrf-token": rCsrf };

    expect((await app.inject({ url: "/api/v1/settings/smtp", headers: asReader })).statusCode).toBe(403);
    expect(
      (await app.inject({
        method: "POST", url: "/api/v1/settings/smtp/test", headers: asReader,
        payload: { to: "someone@example.test" },
      })).statusCode,
    ).toBe(403);
    expect((await app.inject({ url: "/api/v1/settings/smtp" })).statusCode).toBe(401);
  });

  it("records changes in the audit trail without recording the secret", async () => {
    const { rows } = await query<{ action: string; after: string | null }>(
      "select action, after from audit_log where entity_id = 'smtp' order by rowid",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.action === "Email settings saved")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("a-real-secret");
  });
});
