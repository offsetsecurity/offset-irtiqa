import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { config } from "../src/config.js";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { loadPackJourney } from "../src/journey/journey.js";
import { hasCheck } from "../src/journey/checks.js";

/**
 * The readiness plan.
 *
 * The interesting behaviour is entirely about who gets to decide a task is
 * finished: the product, where it can see the answer, or a person, where it
 * cannot. Everything here is about that boundary holding.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

// This product's own pack. It used to be Ascend's, which was fine while every
// product lived in one repository and is a missing folder now that they do not.
const OWN_PACK = resolve(process.cwd(), "../../packs", config.PRODUCT);

/**
 * The steps this suite drives, chosen by what the product checks rather than
 * by name. Every pack has these three; the step called "scope.assets" in one
 * pack is "system.inventory" in another, and a test that knows one pack's
 * names is a test that only runs for one product.
 */
const planTasks = JSON.parse(readFileSync(join(OWN_PACK, "journey.json"), "utf8")) as {
  stages: { tasks: { id: string; check?: string }[] }[];
};
const allTasks = planTasks.stages.flatMap((st) => st.tasks);
const taskWith = (check: string): string => {
  const t = allTasks.find((x) => x.check === check);
  if (!t) throw new Error(`this pack has no step checked by ${check}`);
  return t.id;
};
const PEOPLE_STEP = taskWith("users.beyondAdmin");
const ASSETS_STEP = taskWith("registers.assets");
const MANUAL_STEP = (() => {
  const t = allTasks.find((x) => !x.check);
  if (!t) throw new Error("this pack has no step for a person to tick");
  return t.id;
})();

maybe("readiness plan", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";

  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });
  const read = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}` });

  interface Task {
    id: string; state: string; automatic: boolean; detail: string;
    reason: string; actorName: string;
  }
  interface Stage { id: string; tasks: Task[]; applicable: number; done: number; complete: boolean }
  interface Plan { stages: Stage[]; applicable: number; done: number; pct: number; suggested: string | null }

  const plan = async (): Promise<Plan> => {
    const res = await app.inject({ url: "/api/v1/journey", headers: read() });
    expect(res.statusCode).toBe(200);
    return res.json().journey;
  };

  const taskIn = (p: Plan, id: string): Task =>
    p.stages.flatMap((s) => s.tasks).find((t) => t.id === id)!;

  const set = (id: string, state: string, reason = "") =>
    app.inject({
      method: "PUT",
      url: `/api/v1/journey/${id}`,
      headers: auth(),
      payload: { state, reason },
    });

  beforeAll(async () => {
    await migrate();
    for (const t of [
      "audit_log", "sessions", "users", "controls", "programme", "risks",
      "evidence", "assets", "policies", "tasks", "journey_tasks", "settings",
    ]) {
      await query(`delete from ${t}`);
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

    // Everything below runs against this product's own plan.
    process.env["PACK_DIR"] = OWN_PACK;
  }, 60_000);

  afterAll(async () => {
    delete process.env["PACK_DIR"];
    await app?.close();
    await pool.end();
  });

  /**
   * Every pack ships a plan today, so this builds one that does not rather than
   * naming a product and waiting for that to stop being true.
   */
  it("is offered only to a product whose pack ships a plan", async () => {
    const bare = mkdtempSync(join(tmpdir(), "offset-pack-"));
    // The whole pack, sub-folders such as help/ included, less the plan.
    cpSync(OWN_PACK, bare, {
      recursive: true,
      filter: (src) => basename(src) !== "journey.json",
    });
    const pack = JSON.parse(readFileSync(join(bare, "pack.json"), "utf8")) as {
      features?: Record<string, boolean>;
    };
    delete pack.features?.["journey"];
    writeFileSync(join(bare, "pack.json"), JSON.stringify(pack));

    process.env["PACK_DIR"] = bare;
    expect((await app.inject({ url: "/api/v1/journey", headers: read() })).statusCode).toBe(404);
    expect(
      (await app.inject({
        method: "PUT", url: `/api/v1/journey/${PEOPLE_STEP}`, headers: auth(),
        payload: { state: "done" },
      })).statusCode,
    ).toBe(404);

    process.env["PACK_DIR"] = OWN_PACK;
    rmSync(bare, { recursive: true, force: true });

    expect((await app.inject({ url: "/api/v1/journey", headers: read() })).statusCode).toBe(200);
  });

  /**
   * A typo in a check name would silently turn an automatic task into one
   * somebody has to tick, which is the kind of failure nobody notices until a
   * customer asks why the product stopped checking something.
   */
  it("names only checks that exist", async () => {
    const journey = await loadPackJourney();
    const named = journey.stages.flatMap((s) =>
      s.tasks.map((t) => t.check).filter((c): c is string => Boolean(c)),
    );
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) {
      expect(hasCheck(name), `journey.json names a check that does not exist: ${name}`).toBe(true);
    }
  });

  it("gives every task an id, a title, instructions and a reason to care", async () => {
    const journey = await loadPackJourney();
    const ids = new Set<string>();
    for (const stage of journey.stages) {
      expect(stage.tasks.length).toBeGreaterThan(0);
      for (const t of stage.tasks) {
        expect(t.id, "task without an id").toBeTruthy();
        expect(ids.has(t.id), `duplicate task id: ${t.id}`).toBe(false);
        ids.add(t.id);
        expect(t.title.length).toBeGreaterThan(0);
        expect(t.do.length, `${t.id} has no instructions`).toBeGreaterThan(20);
        expect(t.why.length, `${t.id} does not say why it matters`).toBeGreaterThan(20);
      }
    }
  });

  it("turns a step green on its own when the data says so", async () => {
    // One account, so "add the people who will do the work" is outstanding.
    const before = taskIn(await plan(), PEOPLE_STEP);
    expect(before.automatic).toBe(true);
    expect(before.state).toBe("outstanding");
    expect(before.detail).toContain("only the first account");

    await query(
      `insert into users (id, username, name, email, role, auth_source, password_hash)
       values ($1, 'sara', 'Sara', 'sara@example.test', 'contributor', 'local', 'x')`,
      [randomUUID()],
    );

    const after = taskIn(await plan(), PEOPLE_STEP);
    expect(after.state).toBe("done");
    expect(after.detail).toContain("2 people");
  });

  it("refuses to let somebody tick a step the product checks itself", async () => {
    const res = await set(ASSETS_STEP, "done");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("cannot be ticked by hand");

    // And nothing was written.
    const { rows } = await query("select * from journey_tasks where task_id = $1", [ASSETS_STEP]);
    expect(rows.length).toBe(0);
  });

  it("lets somebody tick a step no software can see", async () => {
    const res = await set(MANUAL_STEP, "done");
    expect(res.statusCode).toBe(200);

    const t = taskIn(res.json().journey, MANUAL_STEP);
    expect(t.automatic).toBe(false);
    expect(t.state).toBe("done");
    expect(t.detail).toContain("Test Admin");
  });

  it("puts a ticked step back", async () => {
    await set(MANUAL_STEP, "outstanding");
    expect(taskIn(await plan(), MANUAL_STEP).state).toBe("outstanding");
    // Back to untouched, not to a row saying "not done".
    const { rows } = await query("select * from journey_tasks where task_id = $1", [MANUAL_STEP]);
    expect(rows.length).toBe(0);
  });

  it("will not exclude anything without a reason", async () => {
    const res = await set("setup.email", "not_applicable", "   ");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("why");
  });

  it("excludes a step, and stops counting it", async () => {
    const before = (await plan()).stages.find((s) => s.id === "setup")!;

    const res = await set("setup.email", "not_applicable", "No mail server on site.");
    expect(res.statusCode).toBe(200);

    const after = (res.json().journey as Plan).stages.find((s) => s.id === "setup")!;
    expect(after.applicable).toBe(before.applicable - 1);
    expect(taskIn(res.json().journey, "setup.email").reason).toBe("No mail server on site.");
  });

  /**
   * An automatic check that kept turning a deliberately excluded task green
   * would be arguing with the customer about their own business.
   */
  it("keeps an exclusion even when the check would pass", async () => {
    // PEOPLE_STEP passes its check now. Exclude it anyway.
    await set(PEOPLE_STEP, "not_applicable", "One-person company.");
    const t = taskIn(await plan(), PEOPLE_STEP);
    expect(t.state).toBe("not_applicable");
    expect(t.automatic).toBe(false);

    await set(PEOPLE_STEP, "outstanding");
    expect(taskIn(await plan(), PEOPLE_STEP).state).toBe("done");
  });

  it("suggests the first unfinished stage, and locks nothing", async () => {
    const p = await plan();
    const firstIncomplete = p.stages.find((s) => !s.complete);
    expect(p.suggested).toBe(firstIncomplete?.id ?? null);

    // Every task in every stage is reachable regardless of what came before.
    const lastStage = p.stages[p.stages.length - 1]!;
    const manual = lastStage.tasks.find((t) => !t.automatic)!;
    expect((await set(manual.id, "done")).statusCode).toBe(200);
    await set(manual.id, "outstanding");
  });

  it("404s a task the pack does not define", async () => {
    expect((await set("not.a.real.task", "done")).statusCode).toBe(404);
  });

  it("is readable by an auditor and closed to them for writing", async () => {
    const argon2 = (await import("argon2")).default;
    const hash = await argon2.hash("read-only-password-here", {
      type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
    });
    await query(
      `insert into users (id,username,name,email,role,auth_source,password_hash)
       values ($1,'ro','Read Only','ro@example.test','readonly','local',$2)`,
      [randomUUID(), hash],
    );
    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: "ro", password: "read-only-password-here" },
    });
    let roSid = "", roCsrf = "";
    for (const c of login.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(c);
      if (m?.[1] === "offset_sid") roSid = m[2]!;
      if (m?.[1] === "offset_csrf") roCsrf = m[2]!;
    }
    const roCookie = { cookie: `offset_sid=${roSid}; offset_csrf=${roCsrf}` };

    expect((await app.inject({ url: "/api/v1/journey", headers: roCookie })).statusCode).toBe(200);
    expect(
      (await app.inject({
        method: "PUT", url: "/api/v1/journey/scope.owner",
        headers: { ...roCookie, "x-csrf-token": roCsrf },
        payload: { state: "done" },
      })).statusCode,
    ).toBe(403);

    expect((await app.inject({ url: "/api/v1/journey" })).statusCode).toBe(401);
  });

  it("records who changed what", async () => {
    const { rows } = await query<{ action: string; entity_id: string }>(
      "select action, entity_id from audit_log where entity = 'journey_task'",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.action === "Plan task excluded")).toBe(true);
    expect(rows.some((r) => r.action === "Plan task updated")).toBe(true);
  });
});
