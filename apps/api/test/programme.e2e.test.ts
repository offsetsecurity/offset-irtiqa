import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";

/**
 * Programme settings and the SP 800-53B baseline operation.
 *
 * The baseline test points PACK_DIR at the Anchor pack and seeds control refs
 * that actually appear in it, because the interesting behaviour is entirely
 * about which refs are in the chosen baseline and what happens to the ones
 * that are not.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

/**
 * Baselines belong to Anchor, so these tests borrow its pack. A repository
 * that holds one product has only its own and skips them; the behaviour is
 * still covered, in Anchor's own repository.
 */
const anchorDir = resolve(process.cwd(), "../../packs/anchor");
const ANCHOR_PACK = existsSync(join(anchorDir, "pack.json")) ? anchorDir : null;
const withBaselines = ANCHOR_PACK ? it : it.skip;

maybe("programme and baselines", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";

  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });
  const read = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}` });

  beforeAll(async () => {
    await migrate();
    for (const t of ["audit_log", "sessions", "users", "controls", "programme"]) {
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
  }, 60_000);

  afterAll(async () => {
    delete process.env["PACK_DIR"];
    await app?.close();
    await pool.end();
  });

  it("creates the programme row on first read", async () => {
    const res = await app.inject({ url: "/api/v1/programme", headers: read() });
    expect(res.statusCode).toBe(200);
    expect(res.json().programme.scope).toBe("");
    expect(res.json().programme.attrs).toEqual({});
  });

  it("merges attrs rather than replacing them", async () => {
    await app.inject({
      method: "PATCH", url: "/api/v1/programme", headers: auth(),
      payload: { attrs: { tiers: { govCur: 2, govTgt: 3 } } },
    });
    // A second screen writing a different key must not wipe the first.
    const res = await app.inject({
      method: "PATCH", url: "/api/v1/programme", headers: auth(),
      payload: { scope: "All UK operations", attrs: { system: { name: "Payroll" } } },
    });
    expect(res.statusCode).toBe(200);

    const { programme } = (await app.inject({ url: "/api/v1/programme", headers: read() })).json();
    expect(programme.scope).toBe("All UK operations");
    expect(programme.attrs.tiers).toEqual({ govCur: 2, govTgt: 3 });
    expect(programme.attrs.system).toEqual({ name: "Payroll" });
  });

  it("refuses a programme write without a CSRF token", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/api/v1/programme", headers: read(), payload: { scope: "x" },
    });
    expect(res.statusCode).toBe(403);
  });

  // True of a product without baselines. Anchor has them, so it is skipped
  // there and the applying tests above carry that side.
  const withoutBaselines = ANCHOR_PACK && process.env["PRODUCT"] === "anchor" ? it.skip : it;

  withoutBaselines("refuses a baseline on a product that does not use them", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/controls/baseline", headers: auth(),
      payload: { level: "moderate" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/does not use/i);
  });

  withBaselines("applies a baseline, and protects a hand-written rationale", async () => {
    process.env["PACK_DIR"] = ANCHOR_PACK!;

    // AC-1 is in every baseline; AC-2(1) is not in low; ZZ-9 is in none.
    const refs: [string, string, string][] = [
      ["AC-1", "not_started", ""],
      ["AC-2(1)", "implemented", ""],
      ["ZZ-9", "implemented", "Deliberately excluded after a risk assessment."],
      ["ZZ-8", "not_applicable", "Not selected in the high baseline (SP 800-53B)."],
    ];
    for (const [ref, status, justification] of refs) {
      await query(
        `insert into controls (id, ref, title, theme, status, justification)
         values ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), ref, `Title ${ref}`, ref.slice(0, 2), status, justification],
      );
    }

    const res = await app.inject({
      method: "POST", url: "/api/v1/controls/baseline", headers: auth(),
      payload: { level: "low" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().level).toBe("low");

    const { rows } = await query<{
      ref: string; status: string; justification: string; attrs: string;
    }>("select ref, status, justification, attrs from controls order by ref");
    const by = Object.fromEntries(rows.map((r) => [r.ref, r]));

    // In the low baseline: kept in scope and flagged.
    expect(JSON.parse(by["AC-1"]!.attrs).inBaseline).toBe(true);
    expect(by["AC-1"]!.status).toBe("not_started");

    // Not in low: taken out of scope with a stated reason.
    expect(by["AC-2(1)"]!.status).toBe("not_applicable");
    expect(JSON.parse(by["AC-2(1)"]!.attrs).inBaseline).toBe(false);
    expect(by["AC-2(1)"]!.justification).toMatch(/Not selected in the low baseline/);

    // Someone's own rationale is never overwritten.
    expect(by["ZZ-9"]!.justification).toBe("Deliberately excluded after a risk assessment.");

    // But a reason this tool wrote earlier is updated to the new level.
    expect(by["ZZ-8"]!.justification).toMatch(/Not selected in the low baseline/);

    const { programme } = (await app.inject({ url: "/api/v1/programme", headers: read() })).json();
    expect(programme.attrs.baseline).toBe("low");
  });

  withBaselines("restores a control when a wider baseline brings it back in scope", async () => {
    process.env["PACK_DIR"] = ANCHOR_PACK!;

    const res = await app.inject({
      method: "POST", url: "/api/v1/controls/baseline", headers: auth(),
      payload: { level: "moderate" },
    });
    expect(res.statusCode).toBe(200);

    const { rows } = await query<{ status: string; justification: string }>(
      "select status, justification from controls where ref = 'AC-2(1)'",
    );
    expect(rows[0]!.status).toBe("not_started");
    expect(rows[0]!.justification).toBe("");

    // The hand-written one stays out of scope, with its own words intact.
    const kept = await query<{ status: string; justification: string }>(
      "select status, justification from controls where ref = 'ZZ-9'",
    );
    expect(kept.rows[0]!.status).toBe("not_applicable");
    expect(kept.rows[0]!.justification).toBe("Deliberately excluded after a risk assessment.");
  });

  withBaselines("writes one audit entry per baseline apply, not one per control", async () => {
    const { rows } = await query<{ n: number }>(
      "select count(*) as n from audit_log where action = 'Baseline applied'",
    );
    expect(rows[0]!.n).toBe(2);
  });
});
