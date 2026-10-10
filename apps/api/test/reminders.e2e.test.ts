import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "../src/config.js";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import {
  addDays, buildReminder, dueItems, isDueToday, stageFor, type DueItem,
} from "../src/mail/reminders.js";
import { controlReminders } from "../src/jobs/handlers.js";

/**
 * Reminders for controls, tasks and readiness-plan steps.
 *
 * Two things are worth protecting. Restraint: nothing is sent without both a
 * date and an address. And reach: every kind of work is chased, because from
 * the recipient's side they are the same thing - something they owe, with a
 * deadline. (The schedule's follow-through, and the chain of people told when
 * something is ignored, are in escalation.e2e.test.ts.)
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

// The readiness plan only exists where the pack ships one, so the plan half
// of this suite needs Ascend rather than the default test product.
// This product's own pack: the suite needs a framework to set due dates on,
// not that framework in particular.
const OWN_PACK = resolve(process.cwd(), "../../packs", config.PRODUCT);

/**
 * A step a person ticks, taken from this product's own plan.
 *
 * The control refs below are fixtures this suite inserts itself, so they hold
 * for any product. A plan step is not: each framework names its steps
 * differently, and one that is checked automatically cannot be given a due
 * date by hand.
 */
const MANUAL_STEP: string = (() => {
  const plan = JSON.parse(readFileSync(join(OWN_PACK, "journey.json"), "utf8")) as {
    stages: { tasks: { id: string; check?: string }[] }[];
  };
  const t = plan.stages.flatMap((st) => st.tasks).find((x) => !x.check);
  if (!t) throw new Error("this pack has no step for a person to tick");
  return t.id;
})();

const day = (offset: number): string =>
  new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

maybe("reminders", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  const ids: Record<string, string> = {};

  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });
  const read = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}` });

  const patchControl = (ref: string, body: Record<string, unknown>) =>
    app.inject({ method: "PATCH", url: `/api/v1/controls/${ids[ref]}`, headers: auth(), payload: body });

  beforeAll(async () => {
    process.env["PACK_DIR"] = OWN_PACK;
    await migrate();
    for (const t of [
      "audit_log", "sessions", "users", "controls", "tasks",
      "journey_tasks", "evidence", "settings",
      // The registers are chased too now, so another suite's dated records
      // would turn up in these counts.
      "attachments", "policies", "vendors", "training", "objectives", "parties",
      "reviews", "communications",
    ]) {
      await query(`delete from ${t}`);
    }

    for (const [ref, theme] of [["1.1.1", "GL"], ["1.1.2", "GL"], ["3.7.1", "OT"]]) {
      const id = randomUUID();
      ids[ref!] = id;
      await query("insert into controls (id, ref, title, theme) values ($1, $2, $3, $4)",
        [id, ref, `Control ${ref}`, theme]);
    }

    app = await buildApp();
    await app.ready();

    const boot = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: {
        username: "admin", name: "Test Admin",
        email: "admin@example.test", password: "correct-horse-battery-staple",
      },
    });
    for (const c of boot.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(c);
      if (m?.[1] === "offset_sid") sid = m[2]!;
      if (m?.[1] === "offset_csrf") csrf = m[2]!;
    }
  }, 60_000);

  afterAll(async () => {
    delete process.env["PACK_DIR"];
    await app?.close();
    await pool.end();
  });

  // ── the schedule ──────────────────────────────────────────────────────────

  it("speaks 30, 15, 7 and 3 days out, on the day, and every day late", () => {
    const today = "2026-03-31";
    expect(stageFor("2026-04-30", today)).toBe("before-30");
    expect(stageFor("2026-04-15", today)).toBe("before-15");
    expect(stageFor("2026-04-07", today)).toBe("before-7");
    expect(stageFor("2026-04-03", today)).toBe("before-3");
    expect(stageFor("2026-03-31", today)).toBe("on");
    expect(stageFor("2026-03-30", today)).toBe("after-1");
    expect(stageFor("2026-01-01", today)).toBe("after-89"); // still late, still chased

    // Between two of those the earlier stage still stands, so a server that
    // was off on the exact day sends it the next, once.
    expect(stageFor("2026-04-20", today)).toBe("before-30");
    expect(stageFor("2026-04-10", today)).toBe("before-15");

    // Nothing before 30 days out.
    expect(stageFor("2026-05-01", today)).toBeNull();
    expect(stageFor("2027-03-31", today)).toBeNull();
    expect(isDueToday("2026-04-30", today)).toBe(true);
    expect(isDueToday("2026-05-01", today)).toBe(false);
  });

  it("does date arithmetic across a month end", () => {
    expect(addDays("2026-03-31", 3)).toBe("2026-04-03");
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  // ── what gets picked up ───────────────────────────────────────────────────

  it("chases nobody without both a date and an address", async () => {
    await patchControl("1.1.1", { dueDate: day(0) });
    await patchControl("1.1.2", { ownerEmail: "nobody@example.test" });
    expect(await dueItems(day(0))).toEqual([]);
  });

  it("picks up a control, a task and a plan step alike", async () => {
    await patchControl("1.1.1", { ownerEmail: "sara@example.test", dueDate: day(-2) });

    await app.inject({
      method: "POST", url: "/api/v1/tasks", headers: auth(),
      payload: {
        title: "Write the backup policy", owner: "Omar",
        ownerEmail: "omar@example.test", dueDate: day(0),
      },
    });

    await app.inject({
      method: "PUT", url: `/api/v1/journey/${MANUAL_STEP}`, headers: auth(),
      payload: {
        state: "outstanding", owner: "Sara",
        ownerEmail: "sara@example.test", dueDate: day(3),
      },
    });

    const items = await dueItems(day(0));
    expect(items.map((i) => i.kind).sort()).toEqual(["control", "step", "task"]);
  });

  it("chases evidence that is due for review", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/evidence", headers: auth(),
      payload: {
        name: "Access review, Q1", type: "Report", owner: "Omar",
        ownerEmail: "omar@example.test", collectedDate: day(-90),
        nextReview: day(0), notes: "",
      },
    });
    expect(res.statusCode).toBe(201);

    const ev = (await dueItems(day(0))).filter((i) => i.kind === "evidence");
    expect(ev.length).toBe(1);
    expect(ev[0]!.title).toBe("Access review, Q1");
    // The review date is the deadline for evidence; there is no separate field.
    expect(ev[0]!.due_date).toBe(day(0));
    expect(ev[0]!.detail).toContain("no document attached");
  });

  it("leaves finished work alone", async () => {
    // A done task, an excluded control and a completed step are not outstanding.
    const { rows } = await query<{ id: string }>("select id from tasks limit 1");
    await app.inject({
      method: "PATCH", url: `/api/v1/tasks/${rows[0]!.id}`, headers: auth(),
      payload: { status: "Done" },
    });
    expect((await dueItems(day(0))).map((i) => i.kind).sort()).toEqual(["control", "evidence", "step"]);

    await app.inject({
      method: "PATCH", url: `/api/v1/tasks/${rows[0]!.id}`, headers: auth(),
      payload: { status: "Open" },
    });
  });

  /**
   * The assignment is the reason to chase, so it has to survive the state it is
   * usually in. Deleting the row on "outstanding" would have thrown away
   * exactly the rows worth chasing.
   */
  it("keeps a plan step's owner when it goes back to outstanding", async () => {
    await app.inject({
      method: "PUT", url: `/api/v1/journey/${MANUAL_STEP}`, headers: auth(),
      payload: { state: "done" },
    });
    await app.inject({
      method: "PUT", url: `/api/v1/journey/${MANUAL_STEP}`, headers: auth(),
      payload: { state: "outstanding" },
    });

    const steps = (await dueItems(day(0))).filter((i) => i.kind === "step");
    expect(steps.length).toBe(1);
    expect(steps[0]!.owner_email).toBe("sara@example.test");
  });

  // ── what the message says ─────────────────────────────────────────────────

  it("writes one email for each thing, never a list", () => {
    const today = day(0);
    const mk = (kind: DueItem["kind"], ref: string, title: string, due: number, owner: string, email: string): DueItem =>
      ({ kind, key: `${kind}:${ref}`, ref, title, due_date: day(due), owner, owner_email: email, detail: "open" });

    const overdue = buildReminder(mk("control", "1.1.1", "A", -2, "Sara", "SARA@Example.test"), "after-2", today);
    expect(overdue.to).toBe("sara@example.test"); // the same address typed two ways is one person
    expect(overdue.subject).toContain("overdue by 2 days");
    expect(overdue.subject).toContain("1.1.1: A");
    expect(overdue.text).toContain("2 days overdue");

    const onTheDay = buildReminder(mk("task", "Task 4", "B", 0, "Sara", "sara@example.test"), "on", today);
    expect(onTheDay.subject).toContain("due today");
    expect(onTheDay.subject).toContain("Task 4: B");

    const ahead = buildReminder(mk("step", "Get ready", MANUAL_STEP, 7, "Sara", "sara@example.test"), "before-7", today);
    expect(ahead.subject).toContain("due in 7 days");

    // Each is about one thing, and does not mention anybody else's.
    expect(overdue.text).not.toContain("Task 4");
    expect(ahead.text).not.toContain("1.1.1");
  });

  it("says so rather than sending when email is off", async () => {
    const out = await controlReminders();
    expect(out.summary).toContain("not sent");
  });

  it("actually delivers, to the addresses on the work", async () => {
    const { SMTPServer } = await import("smtp-server");
    const delivered: string[][] = [];

    const server = new SMTPServer({
      authOptional: true,
      onData(stream, session, callback) {
        stream.on("data", () => {});
        stream.on("end", () => {
          delivered.push(session.envelope.rcptTo.map((r) => r.address));
          callback();
        });
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.server.address() as { port: number }).port;

    await app.inject({
      method: "PUT", url: "/api/v1/settings/smtp", headers: auth(),
      payload: {
        provider: "custom", enabled: true, host: "127.0.0.1", port, secure: false,
        username: "", fromAddress: "irtiqa@example.test", fromName: "Offset",
        rejectUnauthorized: false,
      },
    });

    const out = await controlReminders();
    await new Promise((r) => setTimeout(r, 150));
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(out.summary).toContain("reminder(s) sent");
    const addresses = [...new Set(delivered.flat())].sort();
    expect(addresses).toEqual(["omar@example.test", "sara@example.test"]);
  }, 30_000);

  it("is readable by an auditor and closed to them for writing", async () => {
    const res = await app.inject({ url: "/api/v1/controls", headers: read() });
    expect(res.statusCode).toBe(200);
  });
});
