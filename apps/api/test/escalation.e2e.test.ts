import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "../src/config.js";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { sendReminders } from "../src/mail/escalation.js";

/**
 * Reminders on a schedule, and who is told when they are ignored.
 *
 * Run against a real mail server that records every message, because the thing
 * worth protecting is what actually arrives: one email per item, on the right
 * day, to the right person, with the right people copied in.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;
const OWN_PACK = resolve(process.cwd(), "../../packs", config.PRODUCT);

const day = (offset: number): string =>
  new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

interface Mail { rcpt: string[]; to: string; cc: string; subject: string; body: string }

maybe("escalation", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  const mails: Mail[] = [];
  let closeMail: () => Promise<void>;

  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });
  const put = (url: string, payload: unknown) => app.inject({ method: "PUT", url, headers: auth(), payload: payload as object });
  const newTask = async (title: string, due: number, email = "sara@example.test") => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/tasks", headers: auth(),
      payload: { title, owner: "Sara", ownerEmail: email, dueDate: day(due) },
    });
    expect(res.statusCode).toBe(201);
    return res.json().task.id as string;
  };

  /** Runs the reminders as if it were `offset` days from now, and returns what was sent. */
  const runOn = async (offset: number) => {
    const before = mails.length;
    const result = await sendReminders(day(offset));
    await new Promise((r) => setTimeout(r, 100));
    return { result, fresh: mails.slice(before) };
  };
  const toOwner = (m: Mail) => m.rcpt.length === 1 && m.rcpt[0] === "sara@example.test";

  const CHAIN = [
    { name: "Priya Nair", email: "admin@example.test", days: 1 },
    { name: "Marcus Webb", email: "manager@example.test", days: 7 },
    { name: "Ines Duarte", email: "director@example.test", days: 15 },
    { name: "Samuel Okoro", email: "ceo@example.test", days: 30 },
  ];

  beforeAll(async () => {
    process.env["PACK_DIR"] = OWN_PACK;
    await migrate();
    for (const t of [
      "audit_log", "sessions", "users", "controls", "tasks", "journey_tasks", "evidence", "settings",
      "attachments", "policies", "vendors", "training", "objectives", "parties", "reviews",
      "communications", "reminder_log",
    ]) {
      await query(`delete from ${t}`);
    }

    // A mail server that keeps what it is sent.
    const { SMTPServer } = await import("smtp-server");
    const server = new SMTPServer({
      authOptional: true,
      onData(stream, session, callback) {
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const head = raw.split(/\r?\n\r?\n/)[0]!.replace(/\r?\n[ \t]+/g, " ");
          const field = (n: string): string => (new RegExp(`^${n}: (.*)$`, "mi").exec(head) ?? [])[1] ?? "";
          mails.push({
            rcpt: session.envelope.rcptTo.map((r) => r.address),
            to: field("To"), cc: field("Cc"), subject: field("Subject"),
            body: raw.split(/\r?\n\r?\n/).slice(1).join("\n\n").replace(/=\r?\n/g, ""),
          });
          callback();
        });
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.server.address() as { port: number }).port;
    closeMail = () => new Promise<void>((resolve) => server.close(() => resolve()));

    app = await buildApp();
    await app.ready();
    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "admin", name: "Test Admin", email: "admin@example.test", password: "correct-horse-battery-staple" },
    });
    for (const c of boot.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(c);
      if (m?.[1] === "offset_sid") sid = m[2]!;
      if (m?.[1] === "offset_csrf") csrf = m[2]!;
    }
    await put("/api/v1/settings/smtp", {
      provider: "custom", enabled: true, host: "127.0.0.1", port, secure: false,
      username: "", fromAddress: "noreply@example.test", fromName: "Offset", rejectUnauthorized: false,
    });
  }, 60_000);

  afterAll(async () => {
    delete process.env["PACK_DIR"];
    await closeMail?.();
    await app?.close();
    await pool.end();
  });

  it("starts with four levels and sensible days", async () => {
    const res = await app.inject({ url: "/api/v1/escalation", headers: auth() });
    expect(res.statusCode).toBe(200);
    const { escalation, schedule, emailReady } = res.json();
    expect(escalation.enabled).toBe(true);
    expect(escalation.chain.map((c: { days: number }) => c.days)).toEqual([1, 7, 15, 30]);
    expect(escalation.chain.map((c: { role: string }) => c.role)[0]).toBe("Administrator");
    expect(schedule.before).toEqual([30, 15, 7, 3]);
    expect(emailReady).toBe(true);
  });

  it("refuses a bad address, a bad number of days, and the wrong number of levels", async () => {
    const withLevel = (i: number, patch: object) => ({ enabled: true, chain: CHAIN.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
    expect((await put("/api/v1/escalation", withLevel(1, { email: "not-an-address" }))).statusCode).toBe(400);
    expect((await put("/api/v1/escalation", withLevel(0, { days: 0 }))).statusCode).toBe(400);
    expect((await put("/api/v1/escalation", withLevel(2, { days: 400 }))).statusCode).toBe(400);
    expect((await put("/api/v1/escalation", { enabled: true, chain: CHAIN.slice(0, 3) })).statusCode).toBe(400);
    expect((await put("/api/v1/escalation", { enabled: true, chain: CHAIN })).statusCode).toBe(200);
  });

  it("sends one email for each thing, and none twice", async () => {
    await newTask("Write the backup policy", 30);
    await newTask("Review the access list", 30);
    const third = await newTask("Test the restore", 30);

    const first = await runOn(0);
    expect(first.result.owner).toBe(3);
    // Three things, three emails, three different subjects: never one list.
    const owners = first.fresh.filter(toOwner);
    expect(owners.length).toBe(3);
    expect(new Set(owners.map((m) => m.subject)).size).toBe(3);
    expect(owners[0]!.subject).toContain("due in 30 days");
    expect(owners.every((m) => (m.body.match(/Task \d+:/g) ?? []).length === 1)).toBe(true);

    expect((await runOn(0)).fresh.length).toBe(0); // the same day again says nothing new
    expect((await runOn(14)).fresh.length).toBe(0); // between two stages, silence

    expect((await runOn(15)).result.owner).toBe(3);
    expect((await runOn(23)).result.owner).toBe(3);
    expect((await runOn(27)).result.owner).toBe(3);
    const onTheDay = await runOn(30);
    expect(onTheDay.result.owner).toBe(3);
    expect(onTheDay.fresh[0]!.subject).toContain("due today");

    // Finished work stops being chased, the rest carries on.
    await app.inject({ method: "PATCH", url: `/api/v1/tasks/${third}`, headers: auth(), payload: { status: "Done" } });
    const late = await runOn(31);
    expect(late.fresh.filter(toOwner).length).toBe(2);
    expect(late.fresh.filter(toOwner)[0]!.subject).toContain("overdue by 1 day");
  }, 60_000);

  it("tells the chain one level at a time, copying everybody above", async () => {
    // Day 31 was run above: the first level was told for the two open tasks.
    const sent = await query<{ to_email: string; level: number; cc: string }>(
      "select to_email, level, cc from reminder_log where kind = 'chain' order by created_at");
    expect(sent.rows.map((r) => r.to_email)).toEqual(["admin@example.test", "admin@example.test"]);
    expect(sent.rows.every((r) => r.cc === "")).toBe(true);

    const d32 = await runOn(32);
    expect(d32.fresh.filter((m) => !toOwner(m)).length).toBe(0); // told once, then quiet

    // Seven days overdue: the administrator's manager, with the administrator copied.
    const d37 = await runOn(37);
    const manager = d37.fresh.filter((m) => m.rcpt.includes("manager@example.test") && !toOwner(m));
    expect(manager.length).toBe(2);
    expect(manager[0]!.to).toContain("manager@example.test");
    expect(manager[0]!.cc).toContain("admin@example.test");
    expect(manager[0]!.body).toContain("also sent to: Priya Nair (Administrator)");
    expect(manager[0]!.body).toContain("will be told");

    // The first level is told again a week after it was first told.
    const d38 = await runOn(38);
    const again = d38.fresh.filter((m) => m.to.includes("admin@example.test") && !toOwner(m));
    expect(again.length).toBe(2);

    // Fifteen days: the next level up, with both below it copied.
    const d45 = await runOn(45);
    const director = d45.fresh.filter((m) => m.to.includes("director@example.test"));
    expect(director.length).toBe(2);
    expect(director[0]!.cc).toContain("admin@example.test");
    expect(director[0]!.cc).toContain("manager@example.test");

    // Thirty: top management, with everybody copied, and told it is level four of four.
    const d60 = await runOn(60);
    const ceo = d60.fresh.filter((m) => m.to.includes("ceo@example.test"));
    expect(ceo.length).toBe(2);
    expect(ceo[0]!.cc.split(",").map((s) => s.trim()).sort()).toEqual(
      ["admin@example.test", "director@example.test", "manager@example.test"]);
    expect(ceo[0]!.body).toContain("also sent to");
    expect(ceo[0]!.body).not.toContain("will be told"); // nobody above them

    // Nobody is ever told twice in a day.
    expect((await runOn(60)).fresh.length).toBe(0);
  }, 120_000);

  it("skips a level with no address, and still copies the ones that have", async () => {
    await query("delete from reminder_log");
    await query("delete from tasks");
    await put("/api/v1/escalation", { enabled: true, chain: CHAIN.map((c, i) => (i === 1 ? { ...c, email: "", name: "" } : c)) });
    await newTask("A lone overdue thing", -20);

    const out = await runOn(0);
    const chain = out.fresh.filter((m) => !toOwner(m));
    // 20 days overdue: the administrator and the director; the manager is skipped.
    expect(chain.map((m) => m.to).sort()).toEqual(["admin@example.test", "director@example.test"]);
    expect(chain.find((m) => m.to.includes("director"))!.cc).toBe("admin@example.test");
  });

  it("starts again when the date is moved", async () => {
    await query("delete from reminder_log");
    await query("delete from tasks");
    const id = await newTask("Moves around", 3);
    expect((await runOn(0)).fresh.length).toBe(1);
    expect((await runOn(0)).fresh.length).toBe(0);

    await app.inject({ method: "PATCH", url: `/api/v1/tasks/${id}`, headers: auth(), payload: { dueDate: day(30) } });
    const moved = await runOn(0);
    expect(moved.fresh.length).toBe(1);
    expect(moved.fresh[0]!.subject).toContain("due in 30 days");
  });

  it("chases nothing without an address, and says so when it is switched off", async () => {
    await query("delete from reminder_log");
    await query("delete from tasks");
    await app.inject({ method: "POST", url: "/api/v1/tasks", headers: auth(), payload: { title: "Nobody to tell", dueDate: day(-5) } });
    expect((await runOn(0)).fresh.length).toBe(0);

    await newTask("Would be chased", -2);
    await put("/api/v1/escalation", { enabled: false, chain: CHAIN });
    const off = await runOn(0);
    expect(off.result.blocked).toContain("turned off");
    expect(off.fresh.length).toBe(0);

    // Run by hand, it still goes - and says what it did.
    const manual = await app.inject({ method: "POST", url: "/api/v1/escalation/run", headers: auth() });
    expect(manual.statusCode).toBe(200);
    expect(manual.json().result.owner).toBe(1);
    await put("/api/v1/escalation", { enabled: true, chain: CHAIN });
  });

  it("keeps a record of what was sent, and whether it arrived", async () => {
    const res = await app.inject({ url: "/api/v1/escalation/log?limit=50", headers: auth() });
    expect(res.statusCode).toBe(200);
    const { log } = res.json();
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]).toMatchObject({ ok: 1, kind: expect.any(String), to_email: expect.any(String) });
  });

  it("is closed to people who are not administrators", async () => {
    const anon = await app.inject({ method: "PUT", url: "/api/v1/escalation", payload: { enabled: true, chain: CHAIN } });
    expect(anon.statusCode).toBe(401);
  });
});
