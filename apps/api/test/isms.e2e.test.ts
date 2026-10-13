import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { seedControls } from "../src/db/seed.js";

/**
 * The management-system registers, the calendar, control testing and the two
 * reports that come with them.
 *
 * The registers themselves are configuration of routes tested elsewhere, so
 * what is tested here is what is new: that each one round-trips its own
 * fields, that the calendar gathers dates from every register and sorts them,
 * that a test recorded against a control stays a record of a day, and that the
 * documents a pack ships are really in it.
 */
/**
 * A pack with the registers and example data this suite drives. Assure's while
 * every product shared a repository; this product's own where it has them, and
 * the suite is skipped where it does not - the feature is covered in the
 * repository of a product that has it.
 */
const ownPack = resolve(process.cwd(), "../../packs", process.env["PRODUCT"] ?? "align");
const ownFeatures = (JSON.parse(readFileSync(join(ownPack, "pack.json"), "utf8")) as {
  features?: Record<string, boolean>;
}).features ?? {};
const ASSURE_PACK = ownPack;

const DB = process.env["E2E_DATABASE_URL"];
// Also skipped where this product has no management-system registers.
const maybe = DB && ownFeatures["ismsRegisters"] === true ? describe : describe.skip;


maybe("the management-system registers", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  let controlId = "";

  const read = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}` });
  const write = () => ({ ...read(), "x-csrf-token": csrf });

  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url, headers: write(), payload });

  beforeAll(async () => {
    process.env["PACK_DIR"] = ASSURE_PACK;
    await migrate();
    for (const t of [
      "audit_log", "sessions", "users", "vendor_controls", "vendor_risks", "training_controls",
      "objective_controls", "objective_risks", "party_controls", "review_controls",
      "communication_controls", "communications",
      "vendors", "training", "objectives", "parties", "reviews",
      "control_tests", "evidence_controls", "risk_controls", "controls", "risks", "evidence",
      "policies", "tasks", "findings", "programme", "settings",
    ]) {
      await query(`delete from ${t}`);
    }
    await seedControls();

    app = await buildApp();
    await app.ready();

    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: {
        username: "admin", name: "Test Admin",
        email: "admin@example.test", password: "correct-horse-battery-staple",
      },
    });
    for (const c of boot.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(c);
      if (m?.[1] === "offset_sid") sid = m[2]!;
      if (m?.[1] === "offset_csrf") csrf = m[2]!;
    }
    // Whichever control comes first in this framework. The suite only needs
    // one that exists, and the refs differ by product.
    const { rows } = await query<{ id: string }>("select id from controls order by ref limit 1");
    controlId = rows[0]!.id;
  }, 60_000);

  afterAll(async () => {
    delete process.env["PACK_DIR"];
    await app?.close();
    await pool.end();
  });

  it("keeps a supplier, what they showed you, and what it is linked to", async () => {
    const created = await post("/api/v1/vendors", {
      name: "Northwind Hosting",
      service: "Hosts the customer portal",
      criticality: "High",
      classification: "Confidential",
      status: "Active",
      owner: "Head of IT",
      assurance: "ISO 27001 certificate, valid to 2027-03",
      assessedDate: "2026-09-01",
      reviewDate: "2027-09-01",
      controlIds: [controlId],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().vendor.assurance).toContain("ISO 27001");

    // Links come back on the list, where they are read from the link table
    // rather than from the row that was just written.
    const list = await app.inject({ url: "/api/v1/vendors", headers: read() });
    expect(list.json().vendors).toHaveLength(1);
    expect(list.json().vendors[0].control_ids).toEqual([controlId]);
  });

  it("keeps training, objectives, interested parties and reviews", async () => {
    expect((await post("/api/v1/training", {
      person: "Sara Ahmed", course: "Annual security awareness",
      audience: "Everyone", completedDate: "2026-09-10", nextDue: "2027-09-10",
    })).statusCode).toBe(201);

    expect((await post("/api/v1/objectives", {
      title: "Every leaver loses access within one working day",
      measure: "Days between leaving date and account disabled",
      target: "1", owner: "Head of HR", dueDate: "2026-12-31", status: "On track",
    })).statusCode).toBe(201);

    expect((await post("/api/v1/parties", {
      name: "Our largest customer", kind: "Customer",
      needs: "Proof of certification each year, and notice of any breach within 24 hours",
      addressed: "Certificate shared at renewal; breach terms in the contract",
    })).statusCode).toBe(201);

    const review = await post("/api/v1/reviews", {
      title: "Internal audit of Annex A 5 and 6", kind: "Internal audit",
      status: "Planned", plannedDate: "2026-11-02", ledBy: "External auditor",
      scope: "Organisational and people controls",
    });
    expect(review.statusCode).toBe(201);
    expect(review.json().review.kind).toBe("Internal audit");

    // A review is not finished until it says when it happened.
    const finished = await app.inject({
      method: "PATCH", url: `/api/v1/reviews/${review.json().review.id}`,
      headers: write(), payload: { status: "Completed", heldDate: "2026-11-02", outcome: "Two minor nonconformities." },
    });
    expect(finished.statusCode).toBe(200);
    expect(finished.json().review.held_date).toBe("2026-11-02");
  });

  it("keeps the communication plan, and shows what is due in the calendar", async () => {
    const created = await post("/api/v1/communications", {
      topic: "Security policy and what it means for you",
      audience: "All staff", owner: "Head of Security", channel: "Email and the intranet",
      frequency: "Yearly, and on joining", lastSent: "2026-01-15", nextDue: "2027-01-15",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().communication.audience).toBe("All staff");

    const list = await app.inject({ method: "GET", url: "/api/v1/communications", headers: read() });
    expect(list.json().communications).toHaveLength(1);

    // Due soon, so the calendar shows it with the screen to go to.
    await post("/api/v1/communications", {
      topic: "Phishing reminder", audience: "All staff", owner: "IT",
      channel: "Email", frequency: "Quarterly", nextDue: "2026-09-30",
    });
    const cal = await app.inject({ method: "GET", url: "/api/v1/calendar?days=730", headers: read() });
    const comms = cal.json().items.filter((i: { kind: string }) => i.kind === "Communication");
    expect(comms.length).toBeGreaterThan(0);
    expect(comms[0].screen).toBe("communications");
  });

  it("plans a change as a task, with what it means for security", async () => {
    const change = await post("/api/v1/tasks", {
      title: "Move file shares to SharePoint",
      kind: "Change",
      securityImpact: "New sharing model; access reviews and DLP rules must be redone before cutover.",
      owner: "IT Manager", dueDate: "2026-12-01", priority: "High",
    });
    expect(change.statusCode).toBe(201);
    expect(change.json().task.kind).toBe("Change");
    expect(change.json().task.security_impact).toContain("access reviews");

    // Anything else is ordinary work, and stays that way by default.
    const plain = await post("/api/v1/tasks", { title: "Write the backup procedure" });
    expect(plain.json().task.kind).toBe("Task");

    const bad = await post("/api/v1/tasks", { title: "Nonsense", kind: "Whatever" });
    expect(bad.statusCode).toBe(400);
  });

  it("records corrective action on the finding that caused it", async () => {
    const created = await post("/api/v1/findings", {
      title: "Leavers not removed from the payroll system",
      type: "Minor nonconformity", source: "Internal audit", owner: "HR Manager",
      dueDate: "2026-10-31", description: "Two of five leavers kept access.",
      rootCause: "Nobody owned the monthly check, so it never ran.",
      actionTaken: "The check is now a recurring task with a named owner.",
      verification: "Re-tested three leavers in October; all removed within a day.",
      verifiedBy: "Internal audit", verifiedDate: "2026-10-30",
    });
    expect(created.statusCode).toBe(201);
    const finding = created.json().finding;
    expect(finding.root_cause).toContain("Nobody owned");
    expect(finding.verified_date).toBe("2026-10-30");
  });

  it("gathers every date into one calendar, soonest first", async () => {
    await post("/api/v1/policies", { name: "Information security policy", reviewDate: "2026-09-20" });
    await post("/api/v1/tasks", { title: "Write the access control procedure", dueDate: "2026-09-25" });
    await post("/api/v1/evidence", { name: "Access review", nextReview: "2026-10-05" });
    // The review created earlier was completed, and a completed one is not
    // something to plan for. The audit programme is the planned ones.
    await post("/api/v1/reviews", {
      title: "Management review, first half", kind: "Management review",
      status: "Planned", plannedDate: "2026-12-15",
    });

    const res = await app.inject({ url: "/api/v1/calendar?days=730", headers: read() });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const kinds = body.items.map((i: { kind: string }) => i.kind);
    for (const kind of [
      "Policy review", "Task", "Finding", "Evidence refresh", "Supplier review",
      "Objective", "Training", "Audit or review",
    ]) {
      expect(kinds, `${kind} is missing from the calendar`).toContain(kind);
    }

    const dates = body.items.map((i: { due: string }) => i.due);
    expect([...dates].sort()).toEqual(dates);
    expect(body.counts.overdue + body.counts.soon + body.counts.later).toBe(body.items.length);

    // Each row says which screen to change it on.
    for (const item of body.items) expect(item.screen).toBeTruthy();
  });

  it("puts the certificate's expiry on the calendar, and takes it off when cleared", async () => {
    const expires = new Date(Date.now() + 100 * 86_400_000).toISOString().slice(0, 10);
    const patch = (certification: Record<string, string>) =>
      app.inject({ method: "PATCH", url: "/api/v1/programme", headers: write(), payload: { attrs: { certification } } });
    const certItems = async () =>
      (await app.inject({ url: "/api/v1/calendar?days=730", headers: read() })).json().items
        .filter((i: { kind: string }) => i.kind === "Certificate expiry");

    expect((await patch({ body: "BSI", number: "IS 123456", issued: "2026-01-10", expires })).statusCode).toBe(200);
    const [item] = await certItems();
    expect(item).toMatchObject({ due: expires, screen: "isms", detail: "IS 123456", owner: "BSI" });

    await patch({ body: "BSI", number: "IS 123456", issued: "2026-01-10", expires: "" });
    expect(await certItems()).toHaveLength(0);
  });

  it("keeps a control test as a record of a day, and lets it be taken back", async () => {
    const added = await post(`/api/v1/controls/${controlId}/tests`, {
      testedOn: "2026-09-15", tester: "Priya", result: "Partial",
      note: "Two of the three suppliers had current certificates.",
    });
    expect(added.statusCode).toBe(201);
    const test = added.json().test;

    const list = await app.inject({ url: `/api/v1/controls/${controlId}/tests`, headers: read() });
    expect(list.json().tests).toHaveLength(1);
    expect(list.json().tests[0].result).toBe("Partial");

    // A test belongs to its control; asking under another one finds nothing.
    const { rows } = await query<{ id: string }>(
      "select id from controls where id <> $1 order by ref limit 1",
      [controlId],
    );
    const elsewhere = await app.inject({
      method: "DELETE", url: `/api/v1/controls/${rows[0]!.id}/tests/${test.id}`, headers: write(),
    });
    expect(elsewhere.statusCode).toBe(404);

    const removed = await app.inject({
      method: "DELETE", url: `/api/v1/controls/${controlId}/tests/${test.id}`, headers: write(),
    });
    expect(removed.statusCode).toBe(204);

    const audit = await query<{ action: string }>(
      "select action from audit_log where action in ('Control tested', 'Control test removed')",
    );
    expect(audit.rows).toHaveLength(2);
  });

  it("offers the two reports this pack asks for, and builds them", async () => {
    const list = await app.inject({ url: "/api/v1/reports", headers: read() });
    const ids = list.json().reports.map((r: { id: string }) => r.id);
    expect(ids).toContain("management-review-pack");
    expect(ids).toContain("document-control-list");

    for (const id of ["management-review-pack", "document-control-list"]) {
      const pdf = await app.inject({ url: `/api/v1/reports/${id}`, headers: read() });
      expect(pdf.statusCode, id).toBe(200);
      expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    }
  });

  (ownFeatures["policyTemplates"] === true ? it : it.skip)("ships the document templates it offers", async () => {
    const index = JSON.parse(
      await readFile(resolve(ASSURE_PACK, "templates/index.json"), "utf8"),
    ) as { note: string; documents: { file: string; title: string; about: string }[] };

    expect(index.documents.length).toBeGreaterThanOrEqual(8);
    for (const doc of index.documents) {
      expect(doc.title.length).toBeGreaterThan(3);
      expect(doc.about.length).toBeGreaterThan(20);
      const bytes = await readFile(resolve(ASSURE_PACK, "templates", doc.file));
      // A .docx is a zip, and an empty one helps nobody.
      expect(bytes.subarray(0, 2).toString()).toBe("PK");
      expect(bytes.length).toBeGreaterThan(10_000);
      expect(bytes.includes(Buffer.from("Offset Security"))).toBe(false);
    }
  });
});
