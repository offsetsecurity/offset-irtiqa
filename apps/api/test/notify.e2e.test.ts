import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";

/**
 * Telling somebody about their own account.
 *
 * The assertion that matters most is a negative one: **the password must never
 * be in the message**. Email is stored unencrypted on machines nobody here
 * controls, backed up, searchable years later and forwarded. A tool for
 * managing information security must not be the thing that leaves a working
 * credential in an inbox.
 *
 * The rest is that neither notification can ever break the operation it
 * follows. Creating a user must succeed with the mail server switched off, on
 * fire, or pointed at a black hole.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

const PASSWORD = "zebra-piano-cobalt-runway";
const NEW_PASSWORD = "walnut-harbour-tessellate";

maybe("account notifications", () => {
  let app: FastifyInstance;
  let server: SMTPServer;
  let port = 0;
  let sid = "";
  let csrf = "";
  const inbox: { to: string[]; body: string }[] = [];

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

  const mailOn = (over: Record<string, unknown> = {}) =>
    app.inject({
      method: "PUT", url: "/api/v1/settings/smtp", headers: auth(),
      payload: {
        provider: "custom", enabled: true, host: "127.0.0.1", port, secure: false,
        username: "", fromAddress: "grc@example.test", fromName: "Offset",
        rejectUnauthorized: false, ...over,
      },
    });

  const addUser = (username: string, email: string) =>
    app.inject({
      method: "POST", url: "/api/v1/users", headers: auth(),
      payload: { username, name: "New Person", email, role: "contributor", password: PASSWORD },
    });

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onData(stream, session, callback) {
        let body = "";
        stream.on("data", (chunk: Buffer) => (body += String(chunk)));
        stream.on("end", () => {
          inbox.push({
            to: session.envelope.rcptTo.map((r: { address: string }) => r.address),
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
    await query("delete from settings where key in ('smtp','digest')");

    app = await buildApp();
    await app.ready();

    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: {
        username: "boss", name: "The Boss", email: "boss@example.test",
        password: "correct-horse-battery-staple",
      },
    });
    [sid, csrf] = cookiesFrom(boot);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("creates the account even with no mail server at all", async () => {
    await query("delete from settings where key = 'smtp'");
    const before = inbox.length;

    const res = await addUser("nomail", "nomail@example.test");
    expect(res.statusCode).toBe(201);
    expect(inbox.length).toBe(before);

    // And they can sign in, which is the thing that actually matters.
    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: "nomail", password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it("creates the account even when the mail server refuses the connection", async () => {
    await mailOn({ port: 1, enabled: false });
    await query(
      "update settings set value = replace(value, '\"enabled\":false', '\"enabled\":true') where key = 'smtp'",
    );
    const res = await addUser("deadmail", "deadmail@example.test");
    expect(res.statusCode).toBe(201);
  }, 40_000);

  it("tells a new person their account exists", async () => {
    await mailOn();
    const before = inbox.length;

    const res = await addUser("priya", "priya@example.test");
    expect(res.statusCode).toBe(201);
    expect(inbox.length).toBe(before + 1);

    const message = inbox.at(-1)!;
    expect(message.to).toEqual(["priya@example.test"]);
    expect(message.body).toContain("priya");
    expect(message.body).toContain("The Boss");
  });

  it("never puts the password in the message", async () => {
    await mailOn();
    const before = inbox.length;
    await addUser("careful", "careful@example.test");
    expect(inbox.length).toBe(before + 1);

    const body = inbox.at(-1)!.body;
    // The whole point of the feature.
    expect(body).not.toContain(PASSWORD);
    // Quoted-printable can split a long line, so check the halves too.
    expect(body.replace(/=\r?\n/g, "")).not.toContain(PASSWORD);
    // And it says why, so nobody "helpfully" adds it later.
    expect(body).toMatch(/not in this message/i);
  });

  it("warns somebody when an administrator changes their password", async () => {
    await mailOn();
    const { rows } = await query<{ id: string }>("select id from users where username = 'priya'");
    const before = inbox.length;

    const res = await app.inject({
      method: "POST", url: `/api/v1/users/${rows[0]!.id}/password`, headers: auth(),
      payload: { password: NEW_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(inbox.length).toBe(before + 1);

    const body = inbox.at(-1)!.body;
    expect(inbox.at(-1)!.to).toEqual(["priya@example.test"]);
    expect(body).toMatch(/password was changed/i);
    // The warning is the point: somebody who did not ask for this should
    // recognise that it is worth questioning.
    expect(body).toMatch(/not expecting this/i);
    expect(body).not.toContain(NEW_PASSWORD);
    expect(body.replace(/=\r?\n/g, "")).not.toContain(NEW_PASSWORD);
  });

  it("still resets the password when the message cannot be sent", async () => {
    await query("delete from settings where key = 'smtp'");
    const { rows } = await query<{ id: string }>("select id from users where username = 'priya'");

    const res = await app.inject({
      method: "POST", url: `/api/v1/users/${rows[0]!.id}/password`, headers: auth(),
      payload: { password: "another-entirely-new-password" },
    });
    expect(res.statusCode).toBe(200);

    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: "priya", password: "another-entirely-new-password" },
    });
    expect(login.statusCode).toBe(200);
  });
});
