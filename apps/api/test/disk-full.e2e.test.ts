import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";

/**
 * GL-1 (go-live check, 15 Nov 2026): a full disk while saving answered
 * "Something went wrong." It must say, in plain words, that the disk is full
 * and nothing was saved, whether the file system or the database ran out.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

const failWith = (code: string) => {
  const err = new Error(`${code}: the disk is full`) as Error & { code: string };
  err.code = code;
  return err;
};

maybe("a full disk is reported in plain words", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    await migrate();
    app = await buildApp();
    // Test-only routes that fail the way a full disk does.
    for (const code of ["ENOSPC", "EDQUOT", "SQLITE_FULL"]) {
      app.get(`/api/v1/test-disk-full/${code}`, async () => { throw failWith(code); });
    }
    app.get("/api/v1/test-disk-full/other", async () => { throw new Error("boom"); });
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  for (const code of ["ENOSPC", "EDQUOT", "SQLITE_FULL"]) {
    it(`GL-1: says the disk is full (${code})`, async () => {
      const res = await app.inject({ method: "GET", url: `/api/v1/test-disk-full/${code}` });
      expect(res.statusCode).toBe(507);
      expect(res.json().error).toMatch(/disk is full/i);
      expect(res.json().error).toMatch(/not saved/i);
      expect(res.body).not.toContain(code);
    });
  }

  it("GL-1: still says 'Something went wrong.' for anything else", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/test-disk-full/other" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("Something went wrong.");
  });
});
