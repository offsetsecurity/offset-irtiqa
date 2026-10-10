import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { seedControls } from "../src/db/seed.js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../src/config.js";
import { pool, query } from "../src/db/pool.js";

/**
 * End-to-end against a real SQLite database. Skipped unless E2E_DATABASE_URL is
 * set, so the default run stays hermetic; CI always sets it. Replaces the curl
 * sequence this was previously proved with by hand.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

maybe("API end to end", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  let controlId = "";

  const cookieHeader = () => `offset_sid=${sid}; offset_csrf=${csrf}`;

  /** Pull the cookie values out of a set-cookie response header. */
  const readCookies = (res: { headers: Record<string, unknown> }): void => {
    const raw = res.headers["set-cookie"];
    for (const c of Array.isArray(raw) ? raw : [raw]) {
      const s = String(c ?? "");
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(s);
      if (m?.[1] === "offset_sid") sid = m[2]!;
      if (m?.[1] === "offset_csrf") csrf = m[2]!;
    }
  };

  beforeAll(async () => {
    await migrate();
    // Fresh slate so assertions about counts are deterministic.
    for (const t of ["risk_controls","evidence_controls","risks","evidence","control_tests","audit_log","sessions","users","controls"]) {
      await query("delete from " + t);
    }
    await seedControls();
    app = await buildApp();
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("reports healthy and ready", async () => {
    expect((await app.inject({ url: "/api/v1/health" })).statusCode).toBe(200);
    const ready = await app.inject({ url: "/api/v1/health/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().status).toBe("ready");
  });

  it("needs bootstrapping, then creates the first admin", async () => {
    expect((await app.inject({ url: "/api/v1/auth/bootstrap" })).json().needsBootstrap).toBe(true);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: {
        username: "admin",
        name: "Test Admin",
        email: "admin@example.test",
        password: "correct-horse-battery-staple",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.role).toBe("admin");
    readCookies(res);
    expect(sid).not.toBe("");
    expect(csrf).not.toBe("");
  });

  it("refuses to bootstrap twice, before even validating the payload", async () => {
    // A well-formed second attempt must be refused...
    const good = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: {
        username: "second",
        name: "Second Admin",
        email: "second@example.test",
        password: "another-long-password",
      },
    });
    expect(good.statusCode).toBe(409);

    // ...and so must a malformed one, with the same answer. A closed endpoint
    // should not tell an anonymous caller how its payload is validated.
    const junk = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { username: "x" },
    });
    expect(junk.statusCode).toBe(409);
  });

  it("serves the seeded framework pack", async () => {
    const res = await app.inject({ url: "/api/v1/controls", headers: { cookie: cookieHeader() } });
    expect(res.statusCode).toBe(200);
    const { controls } = res.json();

    // Against the pack on disk rather than a number typed here. The counts
    // differ by product - 93, 106, 1,014 - and a test that knows one of them
    // is a test that only passes for one product.
    const dir = resolve(process.cwd(), "../../packs", config.PRODUCT);
    const packed = JSON.parse(readFileSync(resolve(dir, "controls.json"), "utf8")) as { ref: string }[];
    const packThemes = JSON.parse(readFileSync(resolve(dir, "themes.json"), "utf8")) as Record<string, string>;

    expect(controls.length).toBe(packed.length);
    controlId = controls[0].id;

    const themes = new Set(controls.map((c: { theme: string }) => c.theme));
    expect([...themes].sort()).toEqual(Object.keys(packThemes).sort());
  });

  it("updates a control and recalculates readiness", async () => {
    expect((await app.inject({ url: "/api/v1/controls/summary", headers: { cookie: cookieHeader() } })).json().readinessPct).toBe(0);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/controls/${controlId}`,
      headers: { cookie: cookieHeader(), "x-csrf-token": csrf },
      payload: { status: "implemented", owner: "S. Patel", attrs: { priority: "High" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().control.status).toBe("implemented");
    expect(res.json().control.attrs.priority).toBe("High");

    const summary = (await app.inject({ url: "/api/v1/controls/summary", headers: { cookie: cookieHeader() } })).json();
    expect(summary.implemented).toBe(1);
    expect(summary.readinessPct).toBe(Math.round((summary.implemented / summary.applicable) * 100));
  });

  it("rejects a write without a CSRF token", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/controls/${controlId}`,
      headers: { cookie: cookieHeader() },
      payload: { status: "not_started" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a write with no session", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/controls/${controlId}`,
      payload: { status: "not_started" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid status", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/controls/${controlId}`,
      headers: { cookie: cookieHeader(), "x-csrf-token": csrf },
      payload: { status: "banana" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates evidence, links it to a control, and closes the gap", async () => {
    const before = (await app.inject({ url: "/api/v1/evidence/summary", headers: { cookie: cookieHeader() } })).json();
    expect(before.controlsImplementedWithoutEvidence).toBe(1);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { cookie: cookieHeader(), "x-csrf-token": csrf },
      payload: {
        name: "SIEM alerting configuration export",
        type: "Screenshot",
        owner: "S. Patel",
        collectedDate: new Date().toISOString().slice(0, 10),
        controlIds: [controlId],
      },
    });
    expect(res.statusCode).toBe(201);

    const after = (await app.inject({ url: "/api/v1/evidence/summary", headers: { cookie: cookieHeader() } })).json();
    expect(after.total).toBe(1);
    expect(after.byFreshness.fresh).toBe(1);
    expect(after.controlsImplementedWithoutEvidence).toBe(0);
  });

  it("creates a risk, scores it, and links a control", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/risks",
      headers: { cookie: cookieHeader(), "x-csrf-token": csrf },
      payload: {
        title: "Phishing steals staff credentials",
        category: "Security",
        likelihood: 4,
        impact: 5,
        resLikelihood: 2,
        resImpact: 5,
        owner: "J. Chen",
        controlIds: [controlId],
      },
    });
    expect(res.statusCode).toBe(201);

    const { risks } = (await app.inject({ url: "/api/v1/risks", headers: { cookie: cookieHeader() } })).json();
    expect(risks).toHaveLength(1);
    expect(risks[0].inherent).toBe(20);
    expect(risks[0].residual).toBe(10);
    expect(risks[0].band).toBe("critical");
    expect(risks[0].control_ids).toContain(controlId);

    const summary = (await app.inject({ url: "/api/v1/risks/summary", headers: { cookie: cookieHeader() } })).json();
    expect(summary.byBand.critical).toBe(1);
    expect(summary.heatmap["5x4"]).toBe(1);
  });

  it("will not accept a risk without naming who accepted it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/risks",
      headers: { cookie: cookieHeader(), "x-csrf-token": csrf },
      payload: { title: "Unowned acceptance", likelihood: 1, impact: 1, status: "Accepted" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("enforces role permissions", async () => {
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
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "ro", password: "read-only-password-here" },
    });
    expect(login.statusCode).toBe(200);

    let roSid = "", roCsrf = "";
    for (const c of login.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(c);
      if (m?.[1] === "offset_sid") roSid = m[2]!;
      if (m?.[1] === "offset_csrf") roCsrf = m[2]!;
    }
    const roCookie = `offset_sid=${roSid}; offset_csrf=${roCsrf}`;

    // can read
    expect((await app.inject({ url: "/api/v1/controls", headers: { cookie: roCookie } })).statusCode).toBe(200);
    // cannot write, even with a valid CSRF token
    expect(
      (await app.inject({
        method: "PATCH",
        url: `/api/v1/controls/${controlId}`,
        headers: { cookie: roCookie, "x-csrf-token": roCsrf },
        payload: { status: "not_started" },
      })).statusCode,
    ).toBe(403);
    // cannot reach an admin-only route
    expect((await app.inject({ url: "/api/v1/users", headers: { cookie: roCookie } })).statusCode).toBe(403);
  });

  it("records every mutation in the audit log", async () => {
    const { rows } = await query<{ action: string }>("select action from audit_log order by id");
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("Bootstrap admin created");
    expect(actions).toContain("Control updated");
    expect(actions).toContain("Evidence added");
    expect(actions).toContain("Risk added");
  });

  it("serves the SPA for a non-API path and JSON 404 for a bad endpoint", async () => {
    const api = await app.inject({ url: "/api/v1/definitely-not-real" });
    expect(api.statusCode).toBe(404);
    expect(api.json().error).toBeTruthy();
  });
});
