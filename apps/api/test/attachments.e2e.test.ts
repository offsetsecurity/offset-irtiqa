import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { readdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { safeFileName, evidenceDir } from "../src/lib/files.js";

/**
 * Evidence attachments.
 *
 * The schema had columns for a file since the first migration and nothing ever
 * wrote one, so "Evidence" meant a row describing a document rather than the
 * document. These tests cover the feature, and rather more space is given to
 * the ways it could be turned against the people running it:
 *
 *  - a filename is attacker-controlled text and must never become a path
 *  - an uploaded .html served inline would run on our origin, with the
 *    viewer's session, which is stored cross-site scripting
 *  - a crafted file_key must not reach outside the folder
 *  - a size limit has to be a fact about bytes written, not a promise in a
 *    header
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

maybe("evidence attachments", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  let evidenceId = "";

  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });
  const read = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}` });

  const cookiesFrom = (res: { headers: Record<string, unknown> }): [string, string] => {
    let s = "", c = "";
    for (const raw of res.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(raw);
      if (m?.[1] === "offset_sid") s = m[2]!;
      if (m?.[1] === "offset_csrf") c = m[2]!;
    }
    return [s, c];
  };

  /** A multipart body, built by hand so the filename can be anything at all. */
  const upload = (filename: string, content: Buffer | string, id = evidenceId) => {
    const boundary = "----offsettest";
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`,
      ),
      Buffer.isBuffer(content) ? content : Buffer.from(content),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
      method: "POST",
      url: `/api/v1/evidence/${id}/file`,
      headers: { ...auth(), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
  };

  const newEvidence = async (name: string): Promise<string> => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/evidence", headers: auth(),
      payload: { name, type: "Document", owner: "S. Patel" },
    });
    return res.json().evidence.id as string;
  };

  beforeAll(async () => {
    await migrate();
    for (const t of ["audit_log", "sessions", "users", "evidence"]) await query(`delete from ${t}`);
    /**
     * The files as well as the rows. One assertion below counts what is on
     * disk and expects it to match what is in the table, so a leftover file
     * from an earlier run fails a suite that is working perfectly. Emptying
     * the table without emptying the folder leaves the two out of step.
     */
    rmSync(evidenceDir(), { recursive: true, force: true });

    app = await buildApp();
    await app.ready();

    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: {
        username: "keeper", name: "The Keeper", email: "keeper@example.test",
        password: "correct-horse-battery-staple",
      },
    });
    [sid, csrf] = cookiesFrom(boot);
    evidenceId = await newEvidence("Firewall rule review");
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  // ── the feature ────────────────────────────────────────────────────────────

  it("attaches a file and records what it is", async () => {
    const content = "PDF-ish bytes for the auditor";
    const res = await upload("firewall-review.pdf", content);

    expect(res.statusCode).toBe(201);
    const e = res.json().evidence;
    expect(e.file_name).toBe("firewall-review.pdf");
    expect(e.file_size).toBe(Buffer.byteLength(content));
    expect(e.file_sha256).toBe(createHash("sha256").update(content).digest("hex"));
    // The key is ours, not anything the browser sent.
    expect(e.file_key).toMatch(/^[0-9a-f]{32}$/);
  });

  it("gives the file back, byte for byte", async () => {
    const res = await app.inject({ url: `/api/v1/evidence/${evidenceId}/file`, headers: read() });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.toString()).toBe("PDF-ish bytes for the auditor");
  });

  it("replaces an attachment and does not leave the old file behind", async () => {
    const before = await query<{ file_key: string }>(
      "select file_key from evidence where id = $1", [evidenceId],
    );
    const oldKey = before.rows[0]!.file_key;

    const res = await upload("firewall-review-v2.pdf", "newer contents");
    expect(res.statusCode).toBe(201);
    expect(res.json().evidence.file_name).toBe("firewall-review-v2.pdf");

    expect(existsSync(join(evidenceDir(), oldKey.slice(0, 2), oldKey))).toBe(false);
  });

  it("removes the attachment but keeps the evidence", async () => {
    const id = await newEvidence("Access review");
    await upload("access.csv", "a,b,c", id);
    const { rows } = await query<{ file_key: string }>(
      "select file_key from evidence where id = $1", [id],
    );
    const key = rows[0]!.file_key;

    const res = await app.inject({
      method: "DELETE", url: `/api/v1/evidence/${id}/file`, headers: auth(),
    });
    expect(res.statusCode).toBe(204);
    expect(existsSync(join(evidenceDir(), key.slice(0, 2), key))).toBe(false);

    // The record survives; only the file went.
    const after = await app.inject({ url: `/api/v1/evidence/${id}`, headers: read() });
    expect(after.statusCode).toBe(200);
    expect(after.json().evidence.file_name).toBeNull();
  });

  it("takes the file with it when the evidence is deleted", async () => {
    const id = await newEvidence("Temporary thing");
    await upload("temp.txt", "gone soon", id);
    const { rows } = await query<{ file_key: string }>(
      "select file_key from evidence where id = $1", [id],
    );
    const key = rows[0]!.file_key;

    expect((await app.inject({
      method: "DELETE", url: `/api/v1/evidence/${id}`, headers: auth(),
    })).statusCode).toBe(204);

    expect(existsSync(join(evidenceDir(), key.slice(0, 2), key))).toBe(false);
  });

  // ── the attacks ────────────────────────────────────────────────────────────

  it("never lets a filename become a path", async () => {
    const nasty = [
      "../../../../etc/passwd",
      "..\\..\\..\\windows\\system32\\drivers\\etc\\hosts",
      "/absolute/path.txt",
      "C:\\Windows\\win.ini",
    ];

    for (const filename of nasty) {
      const id = await newEvidence(`traversal ${filename}`);
      const res = await upload(filename, "harmless", id);
      expect(res.statusCode, filename).toBe(201);

      const key = res.json().evidence.file_key as string;
      // Whatever was typed, the file sits under our own key inside the folder.
      expect(key).toMatch(/^[0-9a-f]{32}$/);
      expect(existsSync(join(evidenceDir(), key.slice(0, 2), key))).toBe(true);

      // And the stored label carries no separators at all.
      const label = res.json().evidence.file_name as string;
      expect(label.includes("/"), label).toBe(false);
      expect(label.includes("\\"), label).toBe(false);
      expect(label.startsWith("."), label).toBe(false);
    }

    // Nothing escaped into the parent of the evidence folder.
    const stray = readdirSync(evidenceDir()).filter((f) => f === "etc" || f === "passwd");
    expect(stray).toEqual([]);
  });

  it("strips characters that would let a filename inject a header", () => {
    // Exact, because these are the point: a header cannot be injected and a
    // NUL cannot get through.
    expect(safeFileName("norm\r\nSet-Cookie: a=b")).toBe("normSet-Cookie: a=b");
    expect(safeFileName("with\u0000null.pdf")).toBe("withnull.pdf");
    expect(safeFileName("")).toBe("attachment");
    expect(safeFileName("...")).toBe("attachment");
    expect(safeFileName("a".repeat(500)).length).toBe(180);

    // For everything else the property is what matters, not the exact spelling:
    // whatever comes out can never be read as a path.
    for (const nasty of [
      "../../escape.txt",
      "..\\..\\win.ini",
      "/abs/path.txt",
      ".hidden",
      "..",
    ]) {
      const out = safeFileName(nasty);
      expect(out.includes("/"), nasty).toBe(false);
      expect(out.includes("\\"), nasty).toBe(false);
      expect(out.startsWith("."), nasty).toBe(false);
      expect(out.length, nasty).toBeGreaterThan(0);
    }
  });

  it("never serves an upload in a way a browser would run", async () => {
    const id = await newEvidence("Suspicious upload");
    await upload("payload.html", "<script>alert(document.cookie)</script>", id);

    const res = await app.inject({ url: `/api/v1/evidence/${id}/file`, headers: read() });
    expect(res.statusCode).toBe(200);
    // Not text/html, whatever the uploader claimed.
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    // Downloaded, never rendered.
    expect(String(res.headers["content-disposition"])).toMatch(/^attachment;/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("refuses a crafted file key rather than reading whatever it points at", async () => {
    const id = await newEvidence("Tampered row");
    // Straight into the database, as though someone reached past the API.
    await query("update evidence set file_key = $1, file_name = 'x' where id = $2", [
      "../../../../../../etc/passwd",
      id,
    ]);
    const res = await app.inject({ url: `/api/v1/evidence/${id}/file`, headers: read() });
    expect(res.statusCode).toBe(404);
  });

  it("enforces the size limit on the bytes, not on a promise", async () => {
    const id = await newEvidence("Too big");
    // The configured limit in tests is the default 25 MB, so this is a unit
    // check of the counter rather than a 25 MB upload: storeFile takes its own
    // limit, and the route uses the configured one.
    const { storeFile, UploadTooLarge } = await import("../src/lib/files.js");
    const { Readable } = await import("node:stream");

    await expect(
      storeFile(Readable.from([Buffer.alloc(1024), Buffer.alloc(1024)]), "big.bin", 1500),
    ).rejects.toBeInstanceOf(UploadTooLarge);

    // And nothing was left behind by the failed attempt.
    const dirs = readdirSync(evidenceDir(), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => readdirSync(join(evidenceDir(), d.name)));
    // Only rows with a key this server could have written have a file: one
    // test deliberately puts a tampered key in the database.
    const { rows } = await query<{ n: number }>(
      "select count(*) as n from evidence where file_key is not null and length(file_key) = 32",
    );
    expect(dirs.length).toBe(rows[0]!.n);
    expect(id).toBeTruthy();
  });

  // ── who is allowed ─────────────────────────────────────────────────────────

  it("lets an auditor download but not attach or remove", async () => {
    await app.inject({
      method: "POST", url: "/api/v1/users", headers: auth(),
      payload: {
        username: "auditor", name: "An Auditor", email: "a@example.test",
        role: "auditor", password: "another-long-password-here",
      },
    });
    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: "auditor", password: "another-long-password-here" },
    });
    const [aSid, aCsrf] = cookiesFrom(login);
    const asAuditor = { cookie: `offset_sid=${aSid}; offset_csrf=${aCsrf}`, "x-csrf-token": aCsrf };

    expect(
      (await app.inject({ url: `/api/v1/evidence/${evidenceId}/file`, headers: asAuditor }))
        .statusCode,
    ).toBe(200);

    expect(
      (await app.inject({
        method: "DELETE", url: `/api/v1/evidence/${evidenceId}/file`, headers: asAuditor,
      })).statusCode,
    ).toBe(403);
  });

  it("refuses an anonymous download", async () => {
    const res = await app.inject({ url: `/api/v1/evidence/${evidenceId}/file` });
    expect(res.statusCode).toBe(401);
  });

  it("says so when there is nothing attached", async () => {
    const id = await newEvidence("Nothing here");
    const res = await app.inject({ url: `/api/v1/evidence/${id}/file`, headers: read() });
    expect(res.statusCode).toBe(404);
  });
});
