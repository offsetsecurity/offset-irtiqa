import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { seedControls } from "../src/db/seed.js";
import { todayIso, dayIso, stampLocal } from "../src/lib/time.js";

/**
 * One "today", everywhere.
 *
 * At 02:00 in India it is still yesterday in UTC. Working the date out in UTC
 * there made evidence collected today show as -1 days old on the golden thread
 * while the evidence list said 0, and the two disagreed about when evidence
 * goes stale. These run the server at exactly that moment.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

const MOMENT = new Date("2026-10-16T20:30:00Z"); // 02:00 on the 17th in India
const TODAY = "2026-10-17";

maybe("today", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  let control = "";
  const read = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}` });
  const write = () => ({ ...read(), "x-csrf-token": csrf });
  const previousTz = process.env["TZ"];

  const add = async (name: string, collectedDate: string | null): Promise<string> => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/evidence", headers: write(),
      payload: { name, collectedDate, controlIds: [control] },
    });
    expect(res.statusCode).toBe(201);
    return res.json().evidence.id as string;
  };
  const listed = async (id: string): Promise<{ age_days: number | null; freshness: string }> =>
    ((await app.inject({ url: "/api/v1/evidence", headers: read() })).json().evidence as { id: string; age_days: number | null; freshness: string }[])
      .find((e) => e.id === id)!;
  const threaded = async (id: string): Promise<{ ageDays: number | null; staleDays: number }> => {
    const body = (await app.inject({ url: "/api/v1/thread", headers: read() })).json() as { staleDays: number; evidence: { id: string; ageDays: number | null }[] };
    return { ageDays: body.evidence.find((e) => e.id === id)!.ageDays, staleDays: body.staleDays };
  };

  beforeAll(async () => {
    process.env["TZ"] = "Asia/Kolkata";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MOMENT);

    await migrate();
    // Only what signing in needs. Controls and evidence are left as other
    // suites have them: later suites build on that data.
    for (const t of ["audit_log", "sessions", "users"]) {
      await query(`delete from ${t}`);
    }
    await seedControls();
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
    control = (await query<{ id: string }>("select id from controls order by ref limit 1")).rows[0]!.id;
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    if (previousTz === undefined) delete process.env["TZ"];
    else process.env["TZ"] = previousTz;
    await app?.close();
    await pool.end();
  });

  it("works out today in the server's zone, not UTC's", () => {
    expect(MOMENT.toISOString().slice(0, 10)).toBe("2026-10-16");
    expect(todayIso()).toBe(TODAY);
    expect(dayIso(-1)).toBe("2026-10-16");
    expect(dayIso(15)).toBe("2026-11-01");
    expect(stampLocal()).toMatch(/^2026-10-17 02:00 Asia\/(Kolkata|Calcutta)$/);
  });

  it("calls evidence collected today 0 days old on the golden thread and in the list alike", async () => {
    const id = await add("Collected today", TODAY);
    expect((await threaded(id)).ageDays).toBe(0);
    expect(await listed(id)).toMatchObject({ age_days: 0, freshness: "fresh" });
  });

  it("never shows a negative age, even for a date ahead of today", async () => {
    const id = await add("Dated tomorrow", "2026-10-18");
    expect((await threaded(id)).ageDays).toBe(0);
    expect((await listed(id)).age_days).toBe(0);
  });

  it("agrees everywhere that 90 days old is due and 91 is stale", async () => {
    const ninety = await add("Ninety days old", "2026-07-19");
    const ninetyOne = await add("Ninety-one days old", "2026-07-18");
    const t90 = await threaded(ninety);
    const t91 = await threaded(ninetyOne);
    expect(t90.ageDays).toBe(90);
    expect(t91.ageDays).toBe(91);
    // The golden thread calls evidence stale when it is older than staleDays.
    expect(t90.ageDays! > t90.staleDays).toBe(false);
    expect(t91.ageDays! > t91.staleDays).toBe(true);
    expect(await listed(ninety)).toMatchObject({ age_days: 90, freshness: "due" });
    expect(await listed(ninetyOne)).toMatchObject({ age_days: 91, freshness: "stale" });
  });

  it("counts stale evidence in the summary exactly as the list labels it", async () => {
    const list = (await app.inject({ url: "/api/v1/evidence", headers: read() })).json().evidence as { freshness: string }[];
    const stale = list.filter((e) => e.freshness === "stale").length;
    expect(stale).toBeGreaterThan(0);
    const res = await app.inject({ url: "/api/v1/evidence/summary", headers: read() });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).toContain(`"stale":${stale}`);
  });
});
