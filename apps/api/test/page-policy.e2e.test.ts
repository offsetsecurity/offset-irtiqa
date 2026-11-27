import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";

/**
 * The page policy: no inline styles or scripts, and nothing from elsewhere
 * may be embedded in the page (G14 of the go-live gate for 0.3.0, 27 Nov
 * 2026: the cross-origin embedder policy was missing). The same as Offset
 * Assure's.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

maybe("page policy headers", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    await migrate();
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("refuses inline styles and scripts", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("G14: sets the cross-origin embedder policy, on the page and the API", async () => {
    for (const url of ["/", "/api/v1/health"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.headers["cross-origin-embedder-policy"], url).toBe("require-corp");
    }
  });
});
