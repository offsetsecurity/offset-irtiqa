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
 * The SAMA document set, filled in from the product: the CISO and the organisation's
 * details, and the registers (risks, assets, incidents, suppliers) put into the documents.
 */
const DB = process.env["E2E_DATABASE_URL"];
const OWN_PACK = resolve(process.cwd(), "../../packs", config.PRODUCT);
// Only the SAMA pack ships these documents.
const maybe = DB && existsSync(resolve(OWN_PACK, "templates", "01_Cyber_Security_Governance_and_Committee_Charter.docx"))
  ? describe : describe.skip;

maybe("filled SAMA documents", { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });
  const text = (buf: Buffer): string =>
    readZip(buf).find((e) => e.name === "word/document.xml")!.data.toString("utf8");
  const download = async (file: string) => {
    const res = await app.inject({ url: `/api/v1/templates/filled/${file}`, headers: auth() });
    expect(res.statusCode, file).toBe(200);
    return text(res.rawPayload);
  };
  const post = (url: string, payload: object) => app.inject({ method: "POST", url, headers: auth(), payload });

  beforeAll(async () => {
    process.env["PACK_DIR"] = OWN_PACK;
    await migrate();
    await seedIfEmpty();
    for (const t of ["audit_log", "sessions", "users", "risk_controls", "risks", "assets", "incidents", "vendors", "settings", "training", "reviews"]) {
      await query(`delete from ${t}`);
    }
    app = await buildApp();
    await app.ready();
    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "samaadmin", name: "Sama Admin", email: "sama@example.test", password: "correct-horse-battery-staple" },
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

  it("offers 34 documents, with the CISO as the default owner", async () => {
    const res = await app.inject({ url: "/api/v1/templates", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.manifest.documents.length).toBe(34);
    expect(body.manifest.ownerKey).toBe("ciso");
    expect(body.manifest.shared.some((s: { name: string }) => s.name === "ciso")).toBe(true);
  });

  it("puts the organisation and the CISO into the documents", async () => {
    const put = await app.inject({
      method: "PUT", url: "/api/v1/templates/answers", headers: auth(),
      payload: { values: { company: "Acme Bank & Co", ciso: "Layla Hassan", committee_chair: "Omar Saleh, Chief Risk Officer" } },
    });
    expect(put.statusCode).toBe(200);
    const charter = await download("01_Cyber_Security_Governance_and_Committee_Charter.docx");
    expect(charter).toContain("Acme Bank &amp; Co");
    expect(charter).toContain("Layla Hassan");
    expect(charter).toContain("Omar Saleh, Chief Risk Officer");
    // the document owner defaults to the CISO, the approver to the committee chair
    const policy = await download("03_Cyber_Security_Policy.docx");
    expect(policy).toContain("Layla Hassan");
    expect(policy).not.toContain("Template instructions");
  });

  it("fills the registers into the documents", async () => {
    await post("/api/v1/risks", { title: "Customer data exposed through a misconfigured bucket", likelihood: 3, impact: 5, owner: "Head of Engineering" });
    await post("/api/v1/assets", { name: "Core banking platform", type: "Software", criticality: "High", classification: "Restricted", owner: "CIO", location: "Riyadh DC" });
    await post("/api/v1/incidents", { title: "Phishing campaign against staff", detectedDate: "2026-09-01", severity: "Medium", owner: "SOC" });
    await post("/api/v1/vendors", { name: "Cloud Hosting Co", service: "Hosting", criticality: "High", assurance: "SOC 2 report" });
    expect(await download("08_Cyber_Security_Risk_Management_Process.docx")).toContain("misconfigured bucket");
    expect(await download("14_Asset_Management.docx")).toContain("Core banking platform");
    expect(await download("26_Cyber_Security_Incident_Management.docx")).toContain("Phishing campaign against staff");
    expect(await download("29_Contract_and_Vendor_Management.docx")).toContain("Cloud Hosting Co");
  });

  it("downloads all 34 in one zip", async () => {
    const res = await app.inject({ url: "/api/v1/templates/filled.zip", headers: auth() });
    expect(res.statusCode).toBe(200);
    const names = readZip(res.rawPayload).map((e) => e.name);
    expect(names.filter((n) => /^\d\d_/.test(n)).length).toBe(34);
  });
});
