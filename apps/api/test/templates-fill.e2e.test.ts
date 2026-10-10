import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "../src/config.js";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { seedIfEmpty } from "../src/db/seed.js";
import { pool, query } from "../src/db/pool.js";
import { readZip } from "../src/lib/zip.js";

/**
 * Filling the templates from the product: answers typed once, and the
 * registers' own records, all arriving in the downloaded document.
 */
const DB = process.env["E2E_DATABASE_URL"];
const OWN_PACK = resolve(process.cwd(), "../../packs", config.PRODUCT);
// Only a pack that ships fillable templates (fields.json) has anything to test.
// This file is for the ISO 27001 set. The SAMA set has its own (sama-fill.e2e.test.ts).
const maybe = DB && existsSync(resolve(OWN_PACK, "templates", "01_Scope_of_the_ISMS.docx")) ? describe : describe.skip;

maybe("filled templates", { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });
  const docXml = (buf: Buffer): string => readZip(buf).find((e) => e.name === "word/document.xml")!.data.toString("utf8");
  const download = async (file: string) => {
    const res = await app.inject({ url: `/api/v1/templates/filled/${file}`, headers: auth() });
    expect(res.statusCode, file).toBe(200);
    return res.rawPayload;
  };

  beforeAll(async () => {
    process.env["PACK_DIR"] = OWN_PACK;
    await migrate();
    await seedIfEmpty();
    for (const t of [
      "audit_log", "sessions", "users", "risk_controls", "risks", "tasks", "settings", "policies", "vendors",
      "objectives", "parties", "reviews", "communications", "findings",
    ]) {
      await query(`delete from ${t}`);
    }
    app = await buildApp();
    await app.ready();
    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "tpladmin", name: "Template Admin", email: "tpl@example.test", password: "correct-horse-battery-staple" },
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

  it("needs a session", async () => {
    expect((await app.inject({ url: "/api/v1/templates" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/v1/templates/filled.zip" })).statusCode).toBe(401);
  });

  it("describes the questions and how much of each document is filled", async () => {
    const res = await app.inject({ url: "/api/v1/templates", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.manifest.documents.length).toBeGreaterThanOrEqual(14);
    expect(body.manifest.shared.some((s: { name: string }) => s.name === "company")).toBe(true);
    const scope = body.status.find((s: { file: string }) => s.file.startsWith("01_"));
    expect(scope.left).toBeGreaterThan(10);
  });

  it("puts a company's answers into every document that needs them", async () => {
    const put = await app.inject({
      method: "PUT", url: "/api/v1/templates/answers", headers: auth(),
      payload: { values: { company: "Acme & Sons", isms_manager: "Priya Shah", doc_location: "SharePoint > ISMS" } },
    });
    expect(put.statusCode).toBe(200);
    for (const f of ["01_Scope_of_the_ISMS.docx", "02_ISMS_Policy.docx", "13_Risk_Treatment_Plan.docx"]) {
      expect(docXml(await download(f)), f).toContain("Acme &amp; Sons");
    }
    // the document owner defaults to the ISMS Manager
    expect(docXml(await download("02_ISMS_Policy.docx"))).toContain("Priya Shah");
  });

  it("refuses a name no template uses", async () => {
    const res = await app.inject({
      method: "PUT", url: "/api/v1/templates/answers", headers: auth(), payload: { values: { not_a_blank: "x" } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("fills the scope and the risk treatment plan from the screens", async () => {
    await app.inject({
      method: "PATCH", url: "/api/v1/programme", headers: auth(),
      payload: {
        scope: "The ISMS covers software development and support from Pune.",
        attrs: { context: [{ id: "a", type: "External", issue: "Customer contracts require ISO 27001", impact: "Drives certification" }] },
      },
    });
    await app.inject({
      method: "POST", url: "/api/v1/parties", headers: auth(),
      payload: { name: "Largest bank customer", needs: "Annual audit rights", addressed: "Contract clause 9" },
    });
    const risk = await app.inject({
      method: "POST", url: "/api/v1/risks", headers: auth(),
      payload: { title: "Lost laptop exposes customer data", likelihood: 4, impact: 4, treatment: "Mitigate", owner: "IT lead" },
    });
    expect(risk.statusCode).toBe(201);
    await app.inject({
      method: "POST", url: "/api/v1/tasks", headers: auth(),
      payload: { title: "Turn on disk encryption", owner: "IT lead", dueDate: "2027-03-01", riskId: risk.json().risk.id },
    });

    const scope = docXml(await download("01_Scope_of_the_ISMS.docx"));
    for (const s of ["software development and support from Pune", "Customer contracts require ISO 27001", "Largest bank customer", "Annual audit rights"]) {
      expect(scope).toContain(s);
    }
    const plan = docXml(await download("13_Risk_Treatment_Plan.docx"));
    for (const s of ["Lost laptop exposes customer data", "Modify", "Turn on disk encryption", "1 March 2027"]) {
      expect(plan).toContain(s);
    }
    expect(plan).not.toContain("Describe the risk");
  });

  it("fills the Statement of Applicability from the control screen", async () => {
    await query("update controls set status = 'implemented', owner = 'Priya Shah' where ref = (select min(ref) from controls)");
    const buf = await download("11_Statement_of_Applicability.xlsx");
    const sheet = readZip(buf).find((e) => e.name === "xl/worksheets/sheet2.xml")!.data.toString("utf8");
    expect(sheet).toContain("Implemented");
    expect(sheet).toContain("Priya Shah");
    expect(sheet).toContain("Acme &amp; Sons");
  });

  it("downloads every document in one zip", async () => {
    const res = await app.inject({ url: "/api/v1/templates/filled.zip", headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    const names = readZip(res.rawPayload).map((e) => e.name);
    expect(names.filter((n) => /^\d\d_/.test(n)).length).toBeGreaterThanOrEqual(14);
  });

  it("will not let a read-only user save answers", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/v1/templates/answers", payload: { values: {} } });
    expect(res.statusCode).toBe(401);
  });
});
