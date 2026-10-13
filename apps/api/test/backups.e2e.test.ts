import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";

/**
 * The Backups screen, and above all restoring.
 *
 * Restoring replaces everything, while the application is running, so the
 * tests here restore for real and then look: is the data as it was, is the
 * evidence document back byte for byte, is the application still serving, and
 * did it refuse every file it should have refused before touching anything.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

maybe("backups", () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  let pool: { end: () => Promise<void> } | undefined;
  const root = mkdtempSync(join(tmpdir(), "offset-backups-"));
  const backupDir = join(root, "backups");
  const evidenceDir = join(root, "evidence");

  let session = "";
  const cookieOf = (res: LightMyRequestResponse): string => {
    const jar: string[] = [];
    let csrf = "";
    for (const line of (res.headers["set-cookie"] as string[] | undefined) ?? []) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(line);
      if (m) jar.push(`${m[1]}=${m[2]}`);
      if (m?.[1] === "offset_csrf") csrf = m[2]!;
    }
    return JSON.stringify({ cookie: jar.join("; "), csrf });
  };
  const h = (s = session) => {
    const { cookie, csrf } = JSON.parse(s) as { cookie: string; csrf: string };
    return { cookie, "x-csrf-token": csrf };
  };
  const signIn = async (username = "admin", password = "correct-horse-battery-staple") => {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
    expect(res.statusCode).toBe(200);
    return cookieOf(res);
  };

  const multipart = (field: string, filename: string, content: Buffer) => {
    const boundary = "----offsetbackuptest";
    return {
      boundary,
      body: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
            "Content-Type: application/octet-stream\r\n\r\n",
        ),
        content,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    };
  };
  const uploadBackup = (content: Buffer) => {
    const { boundary, body } = multipart("file", "backup.db", content);
    return app.inject({
      method: "POST", url: "/api/v1/backups/upload",
      headers: { ...h(), "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body,
    });
  };
  const restore = (name: string, confirm = "RESTORE") =>
    app.inject({ method: "POST", url: `/api/v1/backups/${encodeURIComponent(name)}/restore`, headers: h(), payload: { confirm } });
  const riskTitles = async () =>
    (await app.inject({ url: "/api/v1/risks", headers: h() })).json().risks.map((r: { title: string }) => r.title);

  const DOCUMENT = Buffer.from("The signed access review, exactly as the auditor saw it.");
  let evidenceId = "";
  let fileKey = "";
  let backupName = "";

  beforeAll(async () => {
    // A high limit, so the backups these tests take and use are not pruned
    // from under them. How many are kept is tested in jobs.e2e.test.ts.
    Object.assign(process.env, { BACKUP_DIR: backupDir, EVIDENCE_DIR: evidenceDir, BACKUP_KEEP: "50" });
    const { migrate } = await import("../src/db/migrate.js");
    const pooled = await import("../src/db/pool.js");
    pool = pooled.pool;
    query = pooled.query as typeof query;
    await migrate();
    for (const t of ["audit_log", "password_resets", "sessions", "evidence_controls", "evidence", "risk_controls", "risks", "users", "settings"]) {
      await query(`delete from ${t}`);
    }
    // The product's controls must exist for a backup to be recognised as this product's.
    const { seedControls } = await import("../src/db/seed.js");
    await seedControls();

    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();

    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "admin", name: "Admin", email: "admin@example.test", password: "correct-horse-battery-staple" },
    });
    session = cookieOf(boot);

    await app.inject({
      method: "POST", url: "/api/v1/risks", headers: h(),
      payload: { title: "In the backup", description: "", category: "Security", likelihood: 3, impact: 3, treatment: "Mitigate", status: "Open", owner: "", controlIds: [] },
    });
    const ev = await app.inject({
      method: "POST", url: "/api/v1/evidence", headers: h(),
      payload: { name: "Access review", type: "Report", owner: "", collectedDate: null, nextReview: null, notes: "" },
    });
    evidenceId = ev.json().evidence.id;
    const { boundary, body } = multipart("file", "review.pdf", DOCUMENT);
    const up = await app.inject({
      method: "POST", url: `/api/v1/evidence/${evidenceId}/file`,
      headers: { ...h(), "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body,
    });
    expect(up.statusCode).toBeLessThan(300);
    const { rows } = await query("select file_key from evidence where id = $1", [evidenceId]);
    fileKey = rows[0]!["file_key"] as string;
  }, 120_000);

  afterAll(async () => {
    delete process.env["BACKUP_DIR"];
    delete process.env["EVIDENCE_DIR"];
    delete process.env["BACKUP_KEEP"];
    await app?.close();
    await pool?.end();
    rmSync(root, { recursive: true, force: true });
  });

  it("is for administrators only", async () => {
    await app.inject({
      method: "POST", url: "/api/v1/users", headers: h(),
      payload: { username: "viewer", name: "Viewer", email: "v@example.test", role: "readonly", password: "another-long-password-here" },
    });
    const viewer = await signIn("viewer", "another-long-password-here");
    expect((await app.inject({ url: "/api/v1/backups" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/v1/backups", headers: h(viewer) })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/v1/backups", headers: h(viewer) })).statusCode).toBe(403);
  });

  it("takes a backup holding the database and the evidence document", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/backups", headers: h() });
    expect(res.statusCode).toBe(201);
    const backup = res.json().backup;
    backupName = backup.name;
    expect(backup).toMatchObject({ kind: "manual", includesEvidence: true, evidenceFiles: 1 });

    const file = new Database(join(backupDir, backupName), { readonly: true });
    const row = file.prepare("select data from offset_backup_files where key = ?").get(fileKey) as { data: Buffer };
    file.close();
    expect(Buffer.from(row.data).equals(DOCUMENT)).toBe(true);

    const list = (await app.inject({ url: "/api/v1/backups", headers: h() })).json().backups;
    expect(list.map((b: { name: string }) => b.name)).toContain(backupName);
  });

  it("downloads exactly the file on disk", async () => {
    const res = await app.inject({ url: `/api/v1/backups/${backupName}/download`, headers: h() });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain(backupName);
    expect(res.rawPayload.equals(readFileSync(join(backupDir, backupName)))).toBe(true);
  });

  it("restores the data and the document, and the application carries on", async () => {
    // Change everything the backup should undo.
    await app.inject({
      method: "POST", url: "/api/v1/risks", headers: h(),
      payload: { title: "Added after the backup", description: "", category: "Security", likelihood: 1, impact: 1, treatment: "Accept", status: "Open", owner: "", controlIds: [] },
    });
    await app.inject({ method: "DELETE", url: `/api/v1/evidence/${evidenceId}/file`, headers: h() });
    expect(existsSync(join(evidenceDir, fileKey.slice(0, 2), fileKey))).toBe(false);
    expect(await riskTitles()).toContain("Added after the backup");

    expect((await restore(backupName, "yes")).statusCode).toBe(400); // must be typed exactly

    const res = await restore(backupName);
    expect(res.statusCode).toBe(200);
    expect(res.json().signedOut).toBe(true);
    const { safetyBackup } = res.json().result;

    // Everyone is signed out, including whoever pressed the button.
    expect((await app.inject({ url: "/api/v1/auth/me", headers: h() })).statusCode).toBe(401);
    session = await signIn();

    expect(await riskTitles()).toEqual(["In the backup"]);
    expect(readFileSync(join(evidenceDir, fileKey.slice(0, 2), fileKey)).equals(DOCUMENT)).toBe(true);
    const doc = await app.inject({ url: `/api/v1/evidence/${evidenceId}/file`, headers: h() });
    expect(doc.rawPayload.equals(DOCUMENT)).toBe(true);

    // The backup's own tables never reach the live database.
    const { rows } = await query("select name from sqlite_master where name like 'offset_backup%'");
    expect(rows).toHaveLength(0);

    // The present was kept first, so the restore itself can be undone.
    expect(existsSync(join(backupDir, safetyBackup))).toBe(true);
    const safety = new Database(join(backupDir, safetyBackup), { readonly: true });
    const titles = (safety.prepare("select title from risks").all() as { title: string }[]).map((r) => r.title);
    safety.close();
    expect(titles).toContain("Added after the backup");

    const audit = await query("select action from audit_log where action = 'Backup restored'");
    expect(audit.rows).toHaveLength(1);
  });

  it("accepts an uploaded backup and restores from it", async () => {
    const bytes = readFileSync(join(backupDir, backupName));
    const up = await uploadBackup(bytes);
    expect(up.statusCode).toBe(201);
    expect(up.json().backup).toMatchObject({ kind: "uploaded", includesEvidence: true });

    const res = await restore(up.json().backup.name);
    expect(res.statusCode).toBe(200);
    session = await signIn();
    expect(await riskTitles()).toEqual(["In the backup"]);
  });

  it("refuses, before changing anything, every file it should", async () => {
    const before = await riskTitles();
    const bytes = readFileSync(join(backupDir, backupName));
    const variant = (name: string, change: (db: Database.Database) => void): Buffer => {
      const path = join(root, name);
      writeFileSync(path, bytes);
      const file = new Database(path);
      change(file);
      file.close();
      return readFileSync(path);
    };
    const refusal = async (content: Buffer) => (await uploadBackup(content)).json().error as string;

    expect(await refusal(Buffer.from("not a database at all"))).toMatch(/not an Offset backup/);
    // A product that does not exist, rather than a sibling: this must fail
    // the same way in a repository that builds one product and in one that
    // builds five.
    expect(await refusal(variant("other.db", (f) =>
      f.prepare("update offset_backup_meta set json = json_set(json, '$.product', 'notours', '$.productName', 'Another Product')").run(),
    ))).toMatch(/from Another Product/);
    expect(await refusal(variant("newer.db", (f) =>
      f.prepare("insert into schema_migrations (name, sha256) values ('9999_from_the_future.sql', 'x')").run(),
    ))).toMatch(/newer version/);
    expect(await refusal(variant("noadmin.db", (f) => f.prepare("update users set disabled = 1").run())))
      .toMatch(/Nobody could sign in/);
    expect(await refusal(variant("tampered.db", (f) =>
      f.prepare("update offset_backup_files set data = ?").run(Buffer.from("a forged document")),
    ))).toMatch(/damaged/);

    // Nothing was left behind, and nothing changed.
    const list = (await app.inject({ url: "/api/v1/backups", headers: h() })).json().backups;
    expect(list.filter((b: { kind: string }) => b.kind === "uploaded")).toHaveLength(1);
    expect(await riskTitles()).toEqual(before);
  });

  it("serves, restores and deletes only real backups inside the folder", async () => {
    writeFileSync(join(root, "secret.txt"), "outside");
    for (const name of ["../secret.txt", "..%2Fsecret.txt", "offset-x.txt", ".env"]) {
      const res = await app.inject({ url: `/api/v1/backups/${encodeURIComponent(name)}/download`, headers: h() });
      expect(res.statusCode, name).toBe(400);
      expect(res.body).not.toContain("outside");
    }
    const del = await app.inject({ method: "DELETE", url: `/api/v1/backups/${backupName}`, headers: h() });
    expect(del.statusCode).toBe(204);
    expect(existsSync(join(backupDir, backupName))).toBe(false);
  });

  it("makes the nightly backup a full one too", async () => {
    const { backup } = await import("../src/jobs/handlers.js");
    const out = await backup();
    expect(out.summary).toMatch(/backup written/);
    const nightly = (await app.inject({ url: "/api/v1/backups", headers: h() })).json().backups
      .find((b: { kind: string }) => b.kind === "nightly");
    expect(nightly).toMatchObject({ includesEvidence: true, evidenceFiles: 1 });
  });
});
