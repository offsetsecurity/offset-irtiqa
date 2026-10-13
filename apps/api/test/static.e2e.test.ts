import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

/**
 * Serving the web bundle.
 *
 * Two things matter here and no other suite looks at either.
 *
 * The cache headers. A hashed bundle is cached for a year and index.html is not
 * cached at all; get that backwards and an upgraded install shows a blank page
 * until somebody thinks to clear their browser.
 *
 * The edge of the web root. Nothing beside it may be served, however the path
 * is spelled. @fastify/static 8 had a path traversal flaw (CVE-2026-15074), and
 * the upgrade to 10 that fixed it also changed what setHeaders receives, which
 * would have turned every static request into a 500. Both are pinned here.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

maybe("web bundle", () => {
  let app: FastifyInstance;
  let pool: { end: () => Promise<void> } | undefined;
  const root = mkdtempSync(join(tmpdir(), "offset-static-"));
  const web = join(root, "public");

  beforeAll(async () => {
    mkdirSync(web);
    writeFileSync(join(web, "index.html"), "<!doctype html><title>index</title>");
    writeFileSync(join(web, "app.ABCD1234.js"), "console.log('bundle')");
    // Beside the web root rather than in it, so reaching it at all is the bug.
    writeFileSync(join(root, "secret.txt"), "TOP-SECRET");

    // Configuration is read once, when the module loads, so the web root has
    // to be named before the application is imported rather than after.
    process.env["WEB_DIR"] = web;
    const { buildApp } = await import("../src/app.js");
    const { migrate } = await import("../src/db/migrate.js");
    ({ pool } = await import("../src/db/pool.js"));
    await migrate();
    app = await buildApp();
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    delete process.env["WEB_DIR"];
    await app?.close();
    await pool?.end();
    rmSync(root, { recursive: true, force: true });
  });

  it("caches a hashed bundle for a year and index.html not at all", async () => {
    const js = await app.inject({ url: "/app.ABCD1234.js" });
    expect(js.statusCode).toBe(200);
    expect(js.headers["cache-control"]).toBe("public, max-age=31536000, immutable");

    const index = await app.inject({ url: "/" });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain("<title>index</title>");
    expect(index.headers["cache-control"]).toBe("no-cache");
  });

  it("answers a deep link with the app and a missing file with a 404", async () => {
    const deep = await app.inject({ url: "/controls" });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain("<title>index</title>");

    // Not index.html in its place, which the browser reports as a MIME error.
    const missing = await app.inject({ url: "/app.ZZZZ9999.js" });
    expect(missing.statusCode).toBe(404);
  });

  it("serves nothing from outside the web root, however the path is written", async () => {
    for (const url of [
      "/../secret.txt",
      "/..%2fsecret.txt",
      "/%2e%2e/secret.txt",
      "/%2e%2e%2fsecret.txt",
      "/..%5csecret.txt",
      "/%252e%252e%252fsecret.txt",
      "//../secret.txt",
      "/controls/../../secret.txt",
    ]) {
      const res = await app.inject({ url });
      expect(res.body, url).not.toContain("TOP-SECRET");
    }
  });
});
