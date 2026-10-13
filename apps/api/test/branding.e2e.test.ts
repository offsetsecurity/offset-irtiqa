import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";

/**
 * The customer's logo on exported reports.
 *
 * Its own file rather than another block in reports.e2e.test.ts: two suites in
 * one file share a database connection, and the first one to finish closes it
 * out from under the second.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

maybe("report branding", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });
  const read = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}` });

  /** A tall square and a very wide banner — the two shapes that break layouts. */
  const SQUARE =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#0f766e"/></svg>';
  const WIDE =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 90"><rect width="900" height="90" fill="#7c3aed"/></svg>';

  beforeAll(async () => {
    await migrate();
    for (const t of ["audit_log", "sessions", "users", "settings"]) await query(`delete from ${t}`);
    app = await buildApp();
    await app.ready();
    const boot = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: {
        username: "admin2", name: "Test Admin",
        email: "admin2@example.test", password: "correct-horse-battery-staple",
      },
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

  const setLogo = (data: string, filename: string) =>
    app.inject({
      method: "PUT", url: "/api/v1/settings/branding", headers: auth(),
      payload: { logo: { kind: "svg", data, filename } },
    });

  it("refuses a file the PDF engine cannot draw, before it is saved", async () => {
    const res = await setLogo("<svg><this is not svg", "broken.svg");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/could not be drawn/i);

    // Nothing was stored, so reports still work.
    const { rows } = await query("select * from settings where key = 'branding'");
    expect(rows).toHaveLength(0);
  });

  it("refuses a logo over the size limit", async () => {
    const huge = `<svg xmlns="http://www.w3.org/2000/svg">${"<!--x-->".repeat(90_000)}</svg>`;
    const res = await setLogo(huge, "huge.svg");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/512 KB/);
  });

  it("puts the customer's logo on the report and credits the tool in the footer", async () => {
    expect((await setLogo(WIDE, "acme.svg")).statusCode).toBe(200);

    const res = await app.inject({ url: "/api/v1/reports/executive-summary", headers: read() });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("scales any shape into the same box, so nothing collides with the title", async () => {
    for (const [name, svg] of [["square", SQUARE], ["wide", WIDE]] as const) {
      expect((await setLogo(svg, `${name}.svg`)).statusCode).toBe(200);
      const res = await app.inject({ url: "/api/v1/reports/executive-summary", headers: read() });
      expect(res.statusCode, name).toBe(200);
      expect(res.rawPayload.length, name).toBeGreaterThan(3000);
    }
  });

  it("only an administrator may change it", async () => {
    const argon2 = (await import("argon2")).default;
    const hash = await argon2.hash("contributor-password-here", {
      type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
    });
    await query(
      `insert into users (id,username,name,email,role,auth_source,password_hash)
       values ($1,'contrib','Contributor','c@example.test','contributor','local',$2)`,
      [randomUUID(), hash],
    );
    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: "contrib", password: "contributor-password-here" },
    });
    let cSid = "", cCsrf = "";
    for (const c of login.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(c);
      if (m?.[1] === "offset_sid") cSid = m[2]!;
      if (m?.[1] === "offset_csrf") cCsrf = m[2]!;
    }
    const res = await app.inject({
      method: "PUT", url: "/api/v1/settings/branding",
      headers: { cookie: `offset_sid=${cSid}; offset_csrf=${cCsrf}`, "x-csrf-token": cCsrf },
      payload: { logo: null },
    });
    expect(res.statusCode).toBe(403);
  });

  it("clears the logo and records both changes", async () => {
    const res = await app.inject({
      method: "PUT", url: "/api/v1/settings/branding", headers: auth(), payload: { logo: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().branding.logo).toBeNull();

    const { rows } = await query<{ action: string }>("select action from audit_log");
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("Report logo set");
    expect(actions).toContain("Report logo removed");
  });
});
