import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Files on register records, reminders on them, and the evidence count on
 * controls.
 *
 * An auditor asks for the signed contract on a supplier or the minutes of a
 * management review. Those files now sit on the record itself, so what matters
 * here: they arrive intact, come back only as downloads, go with their record
 * when it is deleted, survive a backup and restore, and never land on a record
 * that does not exist.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

maybe("register files, reminders and evidence counts", () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  let pool: { end: () => Promise<void> } | undefined;
  const root = mkdtempSync(join(tmpdir(), "offset-register-files-"));
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
  const upload = (register: string, id: string, filename: string, content: Buffer) => {
    const boundary = "----offsetregisterfiles";
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          "Content-Type: application/octet-stream\r\n\r\n",
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
      method: "POST", url: `/api/v1/attachments/${register}/${id}`,
      headers: { ...h(), "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body,
    });
  };
  const newVendor = async (name: string, extra: Record<string, unknown> = {}): Promise<string> => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/vendors", headers: h(), payload: { name, ...extra },
    });
    expect(res.statusCode).toBe(201);
    return res.json().vendor.id as string;
  };
  const CONTRACT = Buffer.from("Signed data processing agreement, clause 7 on breach notice.");

  beforeAll(async () => {
    Object.assign(process.env, {
      EVIDENCE_DIR: evidenceDir, BACKUP_DIR: join(root, "backups"), BACKUP_KEEP: "50",
    });
    const { migrate } = await import("../src/db/migrate.js");
    const pooled = await import("../src/db/pool.js");
    pool = pooled.pool;
    query = pooled.query as typeof query;
    await migrate();
    for (const t of [
      "attachments", "audit_log", "password_resets", "sessions", "vendor_controls", "vendor_risks",
      "vendors", "training_controls", "training", "evidence_controls", "evidence", "users", "settings",
    ]) {
      await query(`delete from ${t}`);
    }
    const { seedControls } = await import("../src/db/seed.js");
    await seedControls();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "admin", name: "Aisha Admin", email: "admin@example.test", password: "correct-horse-battery-staple" },
    });
    session = cookieOf(boot);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("attaches files to a supplier, lists them, counts them and sends them back as downloads", async () => {
    const id = await newVendor("Northwind Payroll");
    const first = await upload("vendors", id, "DPA signed.pdf", CONTRACT);
    expect(first.statusCode).toBe(201);
    expect(first.json().attachment).toMatchObject({ name: "DPA signed.pdf", size: CONTRACT.length });
    expect(first.json().attachment.fileKey).toBeUndefined(); // the storage key never leaves the server
    await upload("vendors", id, "SOC2 report.xlsx", Buffer.from("spreadsheet"));

    const listed = (await app.inject({ url: `/api/v1/attachments/vendors/${id}`, headers: h() })).json();
    expect(listed.attachments.map((a: { name: string }) => a.name).sort()).toEqual(["DPA signed.pdf", "SOC2 report.xlsx"]);

    const row = (await app.inject({ url: "/api/v1/vendors", headers: h() })).json().vendors
      .find((v: { id: string }) => v.id === id);
    expect(row.attachment_count).toBe(2);

    const file = await app.inject({ url: `/api/v1/attachments/file/${first.json().attachment.id}`, headers: h() });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(CONTRACT)).toBe(true);
    expect(file.headers["content-type"]).toBe("application/octet-stream");
    expect(String(file.headers["content-disposition"])).toMatch(/^attachment;/);

    const trail = await query("select action from audit_log where entity = 'vendors' and entity_id = $1", [id]);
    expect(trail.rows.map((r) => r["action"])).toContain("Supplier file attached");
  });

  it("removes a single file, from the list and from disk", async () => {
    const id = await newVendor("Fabrikam Shredding");
    const added = (await upload("vendors", id, "certificate.pdf", Buffer.from("destruction certificate"))).json().attachment;
    const key = (await query("select file_key from attachments where id = $1", [added.id])).rows[0]!["file_key"] as string;
    expect(existsSync(join(evidenceDir, key.slice(0, 2), key))).toBe(true);

    const gone = await app.inject({ method: "DELETE", url: `/api/v1/attachments/file/${added.id}`, headers: h() });
    expect(gone.statusCode).toBe(204);
    expect(existsSync(join(evidenceDir, key.slice(0, 2), key))).toBe(false);
    expect((await app.inject({ url: `/api/v1/attachments/file/${added.id}`, headers: h() })).statusCode).toBe(404);
  });

  it("takes the files with the record when the record is deleted", async () => {
    const id = await newVendor("Contoso Hosting");
    await upload("vendors", id, "contract.pdf", CONTRACT);
    const key = (await query("select file_key from attachments where entity_id = $1", [id])).rows[0]!["file_key"] as string;

    expect((await app.inject({ method: "DELETE", url: `/api/v1/vendors/${id}`, headers: h() })).statusCode).toBe(204);
    expect((await query("select 1 from attachments where entity_id = $1", [id])).rows).toHaveLength(0);
    expect(existsSync(join(evidenceDir, key.slice(0, 2), key))).toBe(false);
  });

  it("refuses an unknown register, a missing record, and anyone not signed in", async () => {
    const id = await newVendor("Tailspin Couriers");
    expect((await upload("users", id, "x.pdf", CONTRACT)).statusCode).toBe(400);
    expect((await upload("vendors", "00000000-0000-4000-8000-000000000000", "x.pdf", CONTRACT)).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/v1/attachments/vendors/${id}` })).statusCode).toBe(401);
  });

  it("keeps attached files through a backup and a restore", async () => {
    const id = await newVendor("Woodgrove Backup Services");
    const added = (await upload("vendors", id, "assurance.pdf", CONTRACT)).json().attachment;

    const backup = await app.inject({ method: "POST", url: "/api/v1/backups", headers: h() });
    expect(backup.statusCode).toBe(201);

    // Lose it, then restore.
    await app.inject({ method: "DELETE", url: `/api/v1/attachments/file/${added.id}`, headers: h() });
    const restored = await app.inject({
      method: "POST", url: `/api/v1/backups/${encodeURIComponent(backup.json().backup.name)}/restore`,
      headers: h(), payload: { confirm: "RESTORE" },
    });
    expect(restored.statusCode).toBe(200);
    session = cookieOf(await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: "admin", password: "correct-horse-battery-staple" },
    }));

    const back = await app.inject({ url: `/api/v1/attachments/file/${added.id}`, headers: h() });
    expect(back.statusCode).toBe(200);
    expect(back.rawPayload.equals(CONTRACT)).toBe(true);
  });

  it("takes an owner email on the registers, refuses a bad one, and reminds when the date comes", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const bad = await app.inject({
      method: "POST", url: "/api/v1/vendors", headers: h(), payload: { name: "Bad address", ownerEmail: "not-an-email" },
    });
    expect(bad.statusCode).toBe(400);

    await newVendor("Review today Ltd", { ownerEmail: "priya@example.test", owner: "Priya", reviewDate: today, status: "Active" });
    await newVendor("Exited Ltd", { ownerEmail: "priya@example.test", reviewDate: today, status: "Exited" });
    await app.inject({
      method: "POST", url: "/api/v1/training", headers: h(),
      payload: { person: "Omar", ownerEmail: "omar@example.test", course: "Annual awareness", nextDue: today },
    });

    const { dueItems } = await import("../src/mail/reminders.js");
    const due = (await dueItems(today)).filter((i) => i.kind === "record");
    const titles = due.map((d) => `${d.ref}|${d.title}|${d.owner_email}`);
    expect(titles).toContain("Supplier review|Review today Ltd|priya@example.test");
    expect(titles).toContain("Training due|Omar: Annual awareness|omar@example.test");
    // An exited supplier is finished with, and nobody is chased about it.
    expect(titles.some((t) => t.includes("Exited Ltd"))).toBe(false);
  });

  it("tells the control list how much evidence each control has", async () => {
    const controls = (await app.inject({ url: "/api/v1/controls", headers: h() })).json().controls;
    const [a, b] = controls as { id: string; evidence_count: number }[];
    expect(a!.evidence_count).toBe(0);

    await app.inject({
      method: "POST", url: "/api/v1/evidence", headers: h(),
      payload: { name: "Access review", type: "Document", owner: "", controlIds: [a!.id] },
    });
    await app.inject({
      method: "POST", url: "/api/v1/evidence", headers: h(),
      payload: { name: "MFA screenshot", type: "Screenshot", owner: "", controlIds: [a!.id] },
    });

    const after = (await app.inject({ url: "/api/v1/controls", headers: h() })).json().controls as { id: string; evidence_count: number }[];
    expect(after.find((c) => c.id === a!.id)!.evidence_count).toBe(2);
    // Evidence for one control is counted against that control only.
    expect(after.find((c) => c.id === b!.id)!.evidence_count).toBe(0);
  });
});
