import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { buildDigest, DIGEST_DEFAULTS } from "../src/mail/digest.js";
import { emailDigest } from "../src/jobs/handlers.js";

/**
 * The daily digest.
 *
 * The behaviour worth protecting is the restraint: it must say nothing when
 * there is nothing to say, and it must not send at all in that case unless
 * somebody asked for the daily all-clear. A digest that arrives every morning
 * reporting nothing is one people stop opening.
 *
 * The rest is the four ways it declines to send — off, no mail server, nothing
 * to report, nobody to send to — each of which has to be a normal outcome with
 * a readable reason, not an error.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

maybe("daily digest", () => {
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

  const putDigest = (payload: Record<string, unknown>) =>
    app.inject({ method: "PUT", url: "/api/v1/settings/digest", headers: auth(), payload });

  const mailWorking = () =>
    app.inject({
      method: "PUT", url: "/api/v1/settings/smtp", headers: auth(),
      payload: {
        provider: "custom", enabled: true, host: "127.0.0.1", port, secure: false,
        username: "", fromAddress: "grc@example.test", fromName: "Offset",
        rejectUnauthorized: false,
      },
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
    for (const t of ["audit_log", "sessions", "users", "tasks", "findings", "policies", "evidence", "risks", "trend"]) {
      await query(`delete from ${t}`);
    }
    await query("delete from settings where key in ('smtp','digest')");

    app = await buildApp();
    await app.ready();

    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: {
        username: "chief", name: "The Chief", email: "chief@example.test",
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

  beforeEach(async () => {
    for (const t of ["tasks", "findings", "policies", "evidence", "risks", "trend"]) {
      await query(`delete from ${t}`);
    }
  });

  // ── what it says ───────────────────────────────────────────────────────────

  it("reports nothing when there is nothing to report", async () => {
    const digest = await buildDigest();
    expect(digest.actionable).toBe(0);
    expect(digest.subject).toMatch(/nothing needs attention/i);
    expect(digest.body).toContain("Nothing needs attention today.");
  });

  it("lists overdue work, and says how overdue", async () => {
    await query(
      `insert into tasks (id, seq, title, owner, due_date, status) values ($1, 1, $2, $3, $4, 'Open')`,
      [randomUUID(), "Rotate the signing keys", "S. Patel", day(-9)],
    );
    await query(
      `insert into findings (id, seq, title, owner, due_date, status) values ($1, 1, $2, $3, $4, 'Open')`,
      [randomUUID(), "No leaver checklist", "A. Desai", day(-3)],
    );
    await query(
      `insert into evidence (id, name, owner, next_review) values ($1, $2, $3, $4)`,
      [randomUUID(), "Firewall review", "M. Rossi", day(-30)],
    );

    const digest = await buildDigest();
    expect(digest.actionable).toBe(3);
    expect(digest.subject).toMatch(/3 items needing attention/);
    expect(digest.body).toContain("Rotate the signing keys");
    expect(digest.body).toContain("No leaver checklist");
    expect(digest.body).toContain("Firewall review");
    expect(digest.body).toContain(day(-9));
  });

  it("leaves out work that is finished, and risks that are closed", async () => {
    await query(
      `insert into tasks (id, seq, title, due_date, status) values ($1, 1, $2, $3, 'Done')`,
      [randomUUID(), "Already done", day(-20)],
    );
    await query(
      `insert into findings (id, seq, title, due_date, status) values ($1, 1, $2, $3, 'Closed')`,
      [randomUUID(), "Already closed", day(-20)],
    );
    await query(
      `insert into risks (id, seq, title, likelihood, impact, status)
       values ($1, 1, $2, 5, 5, 'Closed')`,
      [randomUUID(), "Closed but severe", ],
    );

    const digest = await buildDigest();
    expect(digest.actionable).toBe(0);
    expect(digest.body).not.toContain("Already done");
    expect(digest.body).not.toContain("Already closed");
    expect(digest.body).not.toContain("Closed but severe");
  });

  it("agrees with the risk register about what the top band is", async () => {
    // 4 x 5 = 20 is critical; 3 x 4 = 12 is elevated and must not appear.
    await query(
      `insert into risks (id, seq, title, likelihood, impact, status) values ($1, 1, $2, 4, 5, 'Open')`,
      [randomUUID(), "Ransomware through a supplier"],
    );
    await query(
      `insert into risks (id, seq, title, likelihood, impact, status) values ($1, 2, $2, 3, 4, 'Open')`,
      [randomUUID(), "Merely elevated"],
    );

    const digest = await buildDigest();
    expect(digest.body).toContain("Ransomware through a supplier");
    expect(digest.body).not.toContain("Merely elevated");
    expect(digest.actionable).toBe(1);
  });

  it("caps a long list and says how many were left out", async () => {
    for (let i = 1; i <= 12; i++) {
      await query(
        `insert into tasks (id, seq, title, due_date, status) values ($1, $2, $3, $4, 'Open')`,
        [randomUUID(), i, `Overdue task ${i}`, day(-i)],
      );
    }
    const digest = await buildDigest();
    // Everything is counted, but only eight are printed.
    expect(digest.actionable).toBe(12);
    expect(digest.body).toContain("Tasks overdue (12)");
    expect(digest.body).toContain("and 4 more");
    // Most overdue first, so the oldest is shown and the freshest is dropped.
    expect(digest.body).toContain("Overdue task 12");
    expect(digest.body).not.toContain("Overdue task 1 ");
    expect(digest.body).not.toContain("Overdue task 4");
  });

  it("only warns about things coming due inside the horizon", async () => {
    await query(`insert into evidence (id, name, next_review) values ($1, $2, $3)`,
      [randomUUID(), "Due next week", day(5)]);
    await query(`insert into evidence (id, name, next_review) values ($1, $2, $3)`,
      [randomUUID(), "Due next year", day(300)]);

    const digest = await buildDigest({ ...DIGEST_DEFAULTS, horizonDays: 14 });
    expect(digest.body).toContain("Due next week");
    expect(digest.body).not.toContain("Due next year");
  });

  it("reports the direction of travel, not just the number", async () => {
    await query("insert into trend (day, pct) values ($1, $2)", [day(-7), 40]);
    await query("insert into trend (day, pct) values ($1, $2)", [day(0), 57]);

    const digest = await buildDigest();
    expect(digest.body).toContain("Readiness: 57%");
    expect(digest.body).toContain("up 17 points in a week");
    // Readiness moving is not by itself a reason to send.
    expect(digest.actionable).toBe(0);
  });

  // ── when it declines to send ───────────────────────────────────────────────

  it("does nothing while it is switched off", async () => {
    const before = inbox.length;
    const result = await emailDigest();
    expect(result.summary).toMatch(/off/i);
    expect(inbox.length).toBe(before);
  });

  it("refuses to be switched on before email works", async () => {
    await query("delete from settings where key = 'smtp'");
    const res = await putDigest({ enabled: true, recipients: [], sendWhenEmpty: false, horizonDays: 14 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/email working first/i);
  });

  it("sends nothing when nothing needs attention", async () => {
    expect((await mailWorking()).statusCode).toBe(200);
    expect((await putDigest({
      enabled: true, recipients: ["ops@example.test"], sendWhenEmpty: false, horizonDays: 14,
    })).statusCode).toBe(200);

    const before = inbox.length;
    const result = await emailDigest();
    expect(result.summary).toMatch(/nothing needs attention/i);
    expect(inbox.length).toBe(before);
  });

  it("sends the all-clear when somebody asked for it", async () => {
    await mailWorking();
    await putDigest({
      enabled: true, recipients: ["ops@example.test"], sendWhenEmpty: true, horizonDays: 14,
    });

    const before = inbox.length;
    const result = await emailDigest();
    expect(result.summary).toMatch(/digest sent/i);
    expect(inbox.length).toBe(before + 1);
    expect(inbox.at(-1)!.to).toEqual(["ops@example.test"]);
  });

  // ── when it does send ──────────────────────────────────────────────────────

  it("actually delivers, to the addresses given", async () => {
    await query(
      `insert into tasks (id, seq, title, owner, due_date, status) values ($1, 1, $2, $3, $4, 'Open')`,
      [randomUUID(), "Patch the edge firewall", "S. Patel", day(-2)],
    );
    await mailWorking();
    await putDigest({
      enabled: true,
      recipients: ["ops@example.test", "risk@example.test"],
      sendWhenEmpty: false,
      horizonDays: 14,
    });

    const before = inbox.length;
    const result = await emailDigest();
    expect(result.summary).toMatch(/digest sent to 2 recipient/);
    expect(inbox.length).toBe(before + 1);
    expect(inbox.at(-1)!.to.sort()).toEqual(["ops@example.test", "risk@example.test"]);
  });

  it("falls back to the administrators when no list is given", async () => {
    await query(
      `insert into tasks (id, seq, title, due_date, status) values ($1, 1, $2, $3, 'Open')`,
      [randomUUID(), "Something overdue", day(-1)],
    );
    await mailWorking();
    await putDigest({ enabled: true, recipients: [], sendWhenEmpty: false, horizonDays: 14 });

    const before = inbox.length;
    await emailDigest();
    expect(inbox.length).toBe(before + 1);
    expect(inbox.at(-1)!.to).toEqual(["chief@example.test"]);
  });

  it("shows what it would say without sending it", async () => {
    await query(
      `insert into tasks (id, seq, title, due_date, status) values ($1, 1, $2, $3, 'Open')`,
      [randomUUID(), "Visible in the preview", day(-4)],
    );
    const before = inbox.length;
    const res = await app.inject({ url: "/api/v1/settings/digest/preview", headers: auth() });

    expect(res.statusCode).toBe(200);
    expect(res.json().body).toContain("Visible in the preview");
    expect(res.json().actionable).toBe(1);
    expect(res.json().wouldSend).toBe(true);
    expect(inbox.length).toBe(before);
  });

  it("is closed to everyone but administrators", async () => {
    await app.inject({
      method: "POST", url: "/api/v1/users", headers: auth(),
      payload: {
        username: "nosy", name: "Nosy", email: "nosy@example.test",
        role: "auditor", password: "another-long-password-here",
      },
    });
    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: "nosy", password: "another-long-password-here" },
    });
    const [nSid, nCsrf] = cookiesFrom(login);
    const asNosy = { cookie: `offset_sid=${nSid}; offset_csrf=${nCsrf}`, "x-csrf-token": nCsrf };

    for (const url of ["/api/v1/settings/digest", "/api/v1/settings/digest/preview"]) {
      expect((await app.inject({ url, headers: asNosy })).statusCode).toBe(403);
    }
    expect(
      (await app.inject({ method: "POST", url: "/api/v1/settings/digest/send", headers: asNosy }))
        .statusCode,
    ).toBe(403);
  });
});
