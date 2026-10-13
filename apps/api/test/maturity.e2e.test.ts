import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { readinessSnapshot } from "../src/jobs/handlers.js";

/**
 * The 0-5 maturity model behind Offset Ascend.
 *
 * Three things are worth proving and none of them are obvious from reading the
 * code: that the accepted range really is 0 to 5 including both ends, that an
 * unscored control is left out of the averages rather than counted as nought,
 * and that readiness changes meaning when a programme is scored instead of
 * ticked.
 *
 * The pack is pointed at Ascend because the maturity fields only make sense
 * against its subdomains, but nothing under test reads the pack: scoring is a
 * property of the control row, so these assertions hold for any pack that
 * turns the feature on.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

const ASCEND_PACK = resolve(process.cwd(), "../../packs/ascend");

maybe("maturity scoring", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  /** ref to id, so the tests can name a subdomain rather than a UUID. */
  const ids: Record<string, string> = {};

  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });
  const read = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}` });

  /** Score one subdomain. Returns the raw reply so callers can assert on it. */
  const score = (ref: string, body: Record<string, unknown>) =>
    app.inject({
      method: "PATCH",
      url: `/api/v1/controls/${ids[ref]}`,
      headers: auth(),
      payload: body,
    });

  const maturityOf = async (ref: string): Promise<number | null> => {
    const res = await app.inject({ url: `/api/v1/controls/${ids[ref]}`, headers: read() });
    expect(res.statusCode).toBe(200);
    return res.json().control.maturity;
  };

  const summary = async (): Promise<{
    total: number; excluded: number; scored: number; unscored: number;
    atTarget: number; atTargetPct: number; average: number;
    defaultTarget: number;
    byLevel: Record<string, number>;
    byTheme: Record<string, { inScope: number; scored: number; atTarget: number; average: number }>;
  }> => {
    const res = await app.inject({ url: "/api/v1/controls/summary", headers: read() });
    expect(res.statusCode).toBe(200);
    return res.json().maturity;
  };

  beforeAll(async () => {
    process.env["PACK_DIR"] = ASCEND_PACK;
    await migrate();
    for (const t of ["audit_log", "sessions", "users", "controls", "trend"]) {
      await query(`delete from ${t}`);
    }

    /**
     * Six rows across two domains, seeded directly. A fixed, tiny set keeps the
     * arithmetic checkable by hand; seeding the whole pack would make every
     * expected figure a mystery.
     */
    const fixture: [string, string][] = [
      ["3.1.1", "LG"], ["3.1.2", "LG"], ["3.1.3", "LG"],
      ["3.3.1", "OT"], ["3.3.2", "OT"], ["3.3.3", "OT"],
    ];
    for (const [ref, theme] of fixture) {
      const id = randomUUID();
      ids[ref] = id;
      await query(
        "insert into controls (id, ref, title, theme) values ($1, $2, $3, $4)",
        [id, ref, `Subdomain ${ref}`, theme],
      );
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

  it("accepts both ends of the scale", async () => {
    // Nought is a real level, not an empty value. A falsy check here would
    // quietly refuse the one score that means "nothing exists yet".
    expect((await score("3.1.1", { maturity: 0 })).statusCode).toBe(200);
    expect(await maturityOf("3.1.1")).toBe(0);

    expect((await score("3.1.1", { maturity: 5 })).statusCode).toBe(200);
    expect(await maturityOf("3.1.1")).toBe(5);
  });

  it("refuses anything off the scale", async () => {
    for (const bad of [-1, 6, 2.5, "3"]) {
      const res = await score("3.1.2", { maturity: bad });
      expect(res.statusCode, `maturity ${JSON.stringify(bad)} should be rejected`).toBe(400);
    }
    // And the row is untouched by the attempts.
    expect(await maturityOf("3.1.2")).toBe(null);
  });

  it("clears a score back to not assessed", async () => {
    await score("3.1.3", { maturity: 4 });
    expect((await score("3.1.3", { maturity: null })).statusCode).toBe(200);
    expect(await maturityOf("3.1.3")).toBe(null);
  });

  it("treats level 3 as the target until somebody says otherwise", async () => {
    await score("3.1.1", { maturity: null });
    const s = await summary();
    expect(s.defaultTarget).toBe(3);
    expect(s.scored).toBe(0);

    await score("3.1.1", { maturity: 3 });
    expect((await summary()).atTarget).toBe(1);

    // Raising the bar on that one subdomain drops it below target without
    // touching its score.
    await score("3.1.1", { targetMaturity: 5 });
    const raised = await summary();
    expect(raised.atTarget).toBe(0);
    expect(raised.average).toBe(3);

    await score("3.1.1", { targetMaturity: null, maturity: null });
  });

  it("leaves unscored subdomains out of the average", async () => {
    // Two scored, four not. Counting the four as nought would give 1.5.
    await score("3.1.1", { maturity: 4 });
    await score("3.1.2", { maturity: 5 });

    const s = await summary();
    expect(s.total).toBe(6);
    expect(s.scored).toBe(2);
    expect(s.unscored).toBe(4);
    expect(s.average).toBe(4.5);
    expect(s.atTarget).toBe(2);
    expect(s.atTargetPct).toBe(100);
  });

  it("reports the spread and the per-domain averages", async () => {
    await score("3.1.1", { maturity: 1 });
    await score("3.1.2", { maturity: 2 });
    await score("3.1.3", { maturity: 3 });
    await score("3.3.1", { maturity: 3 });
    await score("3.3.2", { maturity: 3 });
    await score("3.3.3", { maturity: null });

    const s = await summary();
    expect(s.byLevel).toEqual({ "1": 1, "2": 1, "3": 3 });
    // Five scored, three of them at or above the default target of 3.
    expect(s.atTarget).toBe(3);
    expect(s.atTargetPct).toBe(60);
    expect(s.average).toBe(2.4);

    expect(s.byTheme["LG"]).toEqual({ inScope: 3, scored: 3, atTarget: 1, average: 2 });
    expect(s.byTheme["OT"]).toEqual({ inScope: 3, scored: 2, atTarget: 2, average: 3 });
  });

  it("leaves an excluded subdomain out of every figure", async () => {
    // Carried over: 3.1.1=1, 3.1.2=2, 3.1.3=3, 3.3.1=3, 3.3.2=3, 3.3.3 unscored.
    const before = await summary();
    expect(before.total).toBe(6);
    expect(before.scored).toBe(5);
    expect(before.average).toBe(2.4);

    // A company with no payment systems has no 3.3.1. Excluding it should take
    // it out of the totals rather than leave it sitting in "not assessed".
    await score("3.3.1", { status: "not_applicable" });

    const after = await summary();
    expect(after.total).toBe(5);
    expect(after.excluded).toBe(1);
    expect(after.scored).toBe(4);
    expect(after.unscored).toBe(1);
    // 1 + 2 + 3 + 3 over four, not five.
    expect(after.average).toBe(2.3);
    expect(after.atTarget).toBe(2);
    expect(after.byLevel).toEqual({ "1": 1, "2": 1, "3": 2 });
    expect(after.byTheme["OT"]).toEqual({ inScope: 2, scored: 1, atTarget: 1, average: 3 });

    // The score itself is kept, so changing their mind does not cost them the
    // assessment they already did.
    expect(await maturityOf("3.3.1")).toBe(3);

    await score("3.3.1", { status: "not_started" });
    expect((await summary()).total).toBe(6);
  });

  it("records readiness as the share at target once anything is scored", async () => {
    // Carried over from the test above: 3 of 5 scored subdomains at target.
    const out = await readinessSnapshot();
    expect(out.summary).toContain("60%");
    expect(out.summary).toContain("3 of 5");

    const { rows } = await query<{ pct: number }>("select pct from trend");
    expect(rows[0]?.pct).toBe(60);
  });

  it("falls back to the share implemented when nothing is scored", async () => {
    for (const ref of Object.keys(ids)) await score(ref, { maturity: null });
    await score("3.1.1", { status: "implemented" });
    await score("3.1.2", { status: "implemented" });
    await score("3.1.3", { status: "not_applicable" });

    // Five in scope after the exclusion, two of them implemented.
    const out = await readinessSnapshot();
    expect(out.summary).toContain("40%");
    expect(out.summary).toContain("2 of 5");
  });

  it("is closed to readers", async () => {
    await app.inject({
      method: "POST", url: "/api/v1/users", headers: auth(),
      payload: {
        username: "viewer", name: "View Only", email: "viewer@example.test",
        role: "readonly", password: "another-long-password-here",
      },
    });
    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: "viewer", password: "another-long-password-here" },
    });
    let vsid = "";
    let vcsrf = "";
    for (const c of login.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(c);
      if (m?.[1] === "offset_sid") vsid = m[2]!;
      if (m?.[1] === "offset_csrf") vcsrf = m[2]!;
    }

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/controls/${ids["3.3.1"]}`,
      headers: { cookie: `offset_sid=${vsid}; offset_csrf=${vcsrf}`, "x-csrf-token": vcsrf },
      payload: { maturity: 5 },
    });
    expect(res.statusCode).toBe(403);
  });
});
