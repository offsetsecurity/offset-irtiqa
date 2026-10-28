import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { seedControls } from "../src/db/seed.js";
import { hasFeature, packMeta } from "../src/lib/pack.js";
import { dayIso, todayIso } from "../src/lib/time.js";

/**
 * "If the auditor came today", fix-first, quick wins, the flight path and the
 * bulk change behind Get ready and the Dashboard. Each rule is driven from
 * real rows, so a rule that never fires (or always does) shows up here rather
 * than on a customer's screen.
 *
 * The same file runs in every product with the `readiness` feature. Where the
 * product scores maturity, "in place" means at or above target, so the setup
 * scores a control instead of marking it implemented.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

interface Ready {
  findings: { id: string; ref: string; label: string; weight: number; controlId?: string }[];
  fixFirst: { id: string; weight: number }[];
  quickWins: { id: string; count: number }[];
  keyDate: { title: string; date: string; daysTo: number; ledBy: string } | null;
  words: { auditor: string; keyDate: string };
}

maybe("readiness", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  let scored = false;
  let sop = false;
  let refs: Record<string, string> = {};
  const read = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}` });
  const write = () => ({ ...read(), "x-csrf-token": csrf });
  const ready = async (): Promise<Ready> => {
    const res = await app.inject({ url: "/api/v1/readiness", headers: read() });
    expect(res.statusCode).toBe(200);
    return res.json() as Ready;
  };
  const first = async (): Promise<{ id: string; ref: string; theme: string }> =>
    (await query<{ id: string; ref: string; theme: string }>("select id, ref, theme from controls order by ref limit 1")).rows[0]!;
  /** Puts a control in place, the way this product counts it. */
  const putInPlace = async (id: string): Promise<void> => {
    await query(
      scored ? "update controls set maturity = 5, target_maturity = 3 where id = $1" : "update controls set status = 'implemented' where id = $1",
      [id],
    );
  };

  beforeAll(async () => {
    await migrate();
    for (const t of ["audit_log", "sessions", "users", "evidence_controls", "evidence", "control_tests",
      "findings", "vendors", "policies", "reviews", "trend"]) {
      await query(`delete from ${t}`);
    }
    await query("delete from controls");
    await seedControls();
    scored = await hasFeature("maturity");
    sop = await hasFeature("statementOfApplicability");
    refs = ((await packMeta()) as unknown as { readiness?: { refs?: Record<string, string> } }).readiness?.refs ?? {};
    app = await buildApp();
    await app.ready();
    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "admin", name: "Admin", email: "admin@example.test", password: "correct-horse-battery-staple" },
    });
    for (const c of boot.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(c);
      if (m?.[1] === "offset_sid") sid = m[2]!;
      if (m?.[1] === "offset_csrf") csrf = m[2]!;
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("is turned on for this product, with its own words", async () => {
    expect(await hasFeature("readiness")).toBe(true);
    const r = await ready();
    expect(r.words.auditor).not.toBe("");
    expect(r.words.keyDate).not.toBe("");
  });

  it("starts with one 'not in place' line per theme, weighted by its size", async () => {
    const r = await ready();
    const { rows } = await query<{ theme: string; n: number }>(
      "select theme, count(*) as n from controls where status <> 'not_applicable' group by theme",
    );
    for (const { theme, n } of rows) {
      expect(r.findings.find((f) => f.id === `notyet:${theme}`)?.weight).toBe(n);
    }
    // The biggest theme is what to fix first.
    const biggest = Math.max(...rows.map((x) => x.n));
    expect(r.fixFirst[0]!.weight).toBe(biggest);
  });

  it("says a control in place with nothing to prove it would be raised, and stops once evidence is linked", async () => {
    const c = await first();
    await putInPlace(c.id);
    expect((await ready()).findings.some((f) => f.id === `noev:${c.ref}`)).toBe(true);

    const ev = await app.inject({
      method: "POST", url: "/api/v1/evidence", headers: write(),
      payload: { name: "Signed policy", collectedDate: todayIso(), controlIds: [c.id] },
    });
    expect(ev.statusCode).toBe(201);
    expect((await ready()).findings.some((f) => f.id === `noev:${c.ref}`)).toBe(false);
  });

  it("raises a failed test, and clears it when a passing retest is recorded", async () => {
    const c = await first();
    const fail = await app.inject({
      method: "POST", url: `/api/v1/controls/${c.id}/tests`, headers: write(),
      payload: { testedOn: dayIso(-3), tester: "Internal audit", result: "Fail", note: "2 of 5 leavers kept access" },
    });
    expect(fail.statusCode).toBe(201);
    const found = (await ready()).findings.find((f) => f.id === `test:${c.ref}`)!;
    expect(found.label).toBe("Fail");
    expect(found.controlId).toBe(c.id);

    await app.inject({
      method: "POST", url: `/api/v1/controls/${c.id}/tests`, headers: write(),
      payload: { testedOn: todayIso(), tester: "Internal audit", result: "Pass", note: "All 5 leavers removed" },
    });
    expect((await ready()).findings.some((f) => f.id === `test:${c.ref}`)).toBe(false);
  });

  it("raises a finding left past its due date, under this framework's reference", async () => {
    if (!refs["finding"]) return;
    await query(
      "insert into findings (id, seq, title, status, due_date, owner) values ('f-late', 1, 'Leavers kept access', 'Open', $1, 'IT Manager')",
      [dayIso(-10)],
    );
    const f = (await ready()).findings.find((x) => x.id === "finding:1")!;
    expect(f.label).toBe("Fail");
    expect(f.ref).toBe(refs["finding"]);
  });

  it("asks for an internal audit in the last year, and is satisfied by one held", async () => {
    if (!refs["audit"]) return;
    expect((await ready()).findings.some((f) => f.id === "yearly:audit")).toBe(true);
    await query(
      "insert into reviews (id, seq, title, kind, status, held_date) values ('r-ia', 1, 'Internal audit', 'Internal audit', 'Completed', $1)",
      [dayIso(-30)],
    );
    expect((await ready()).findings.some((f) => f.id === "yearly:audit")).toBe(false);
  });

  it("counts down to the next external audit, and puts what is planned before it on the flight path", async () => {
    expect((await ready()).keyDate).toBeNull();
    await query(
      `insert into reviews (id, seq, title, kind, status, planned_date, led_by) values
         ('r-ext', 2, 'Certification audit', 'External audit', 'Planned', $1, 'Example Certification Ltd'),
         ('r-mr', 3, 'Management review', 'Management review', 'Planned', $2, '')`,
      [dayIso(45), dayIso(20)],
    );
    const k = (await ready()).keyDate!;
    expect(k.daysTo).toBe(45);
    expect(k.ledBy).toBe("Example Certification Ltd");

    const res = await app.inject({ url: "/api/v1/readiness/dashboard", headers: read() });
    expect(res.statusCode).toBe(200);
    const d = res.json() as { keyDate: { daysTo: number }; milestones: { kind: string }[]; lens: { ready: number; questions: number; findings: number; total: number }; trend: unknown[] };
    expect(d.keyDate.daysTo).toBe(45);
    expect(d.milestones.map((m) => m.kind)).toContain("Management review");
    // Every control in scope lands in exactly one of the auditor's three piles.
    expect(d.lens.ready + d.lens.questions + d.lens.findings).toBe(d.lens.total);
    expect(d.trend.length).toBeGreaterThanOrEqual(1);
  });

  it("gives a whole theme one owner, with one audit row per control", async () => {
    const c = await first();
    const res = await app.inject({ method: "POST", url: "/api/v1/controls/bulk", headers: write(), payload: { theme: c.theme, owner: "Head of IT" } });
    expect(res.statusCode).toBe(200);
    const updated = (res.json() as { updated: number }).updated;
    expect(updated).toBeGreaterThan(0);
    const { rows } = await query<{ n: number }>("select count(*) as n from controls where theme = $1 and owner = 'Head of IT'", [c.theme]);
    expect(rows[0]!.n).toBe(updated);
    const audited = await query<{ n: number }>("select count(*) as n from audit_log where action = 'Control updated'");
    expect(audited.rows[0]!.n).toBeGreaterThanOrEqual(updated);
  });

  it("takes a whole theme out of scope only where the framework allows it", async () => {
    const { rows } = await query<{ theme: string }>("select theme from controls group by theme order by theme desc limit 1");
    const res = await app.inject({
      method: "POST", url: "/api/v1/controls/bulk", headers: write(),
      payload: { theme: rows[0]!.theme, outOfScope: "Everyone works remotely; there are no offices" },
    });
    expect(res.statusCode).toBe(sop ? 200 : 400);
    const reason = await app.inject({ method: "POST", url: "/api/v1/controls/bulk", headers: write(), payload: { theme: rows[0]!.theme, outOfScope: "  " } });
    expect(reason.statusCode).toBe(400);
  });

  it("refuses a bulk change without the CSRF token", async () => {
    const c = await first();
    const res = await app.inject({ method: "POST", url: "/api/v1/controls/bulk", headers: read(), payload: { theme: c.theme, owner: "Nobody" } });
    expect(res.statusCode).toBe(403);
  });
});
