import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { seedControls } from "../src/db/seed.js";
import { pool, query } from "../src/db/pool.js";

/**
 * The five Phase 3 registers. They share one implementation, so this covers
 * the shared behaviour once and then the bits each one adds of its own:
 * policy version archiving, the closed-finding rule, and the two link shapes.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

maybe("registers", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  let controlId = "";
  let riskId = "";

  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });
  const read = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}` });

  beforeAll(async () => {
    await migrate();
    for (const t of [
      "asset_controls", "asset_risks", "policy_controls", "policy_versions",
      "policy_acknowledgements",
      "incident_controls", "incident_risks", "finding_controls",
      "assets", "policies", "tasks", "incidents", "findings",
      "risk_controls", "evidence_controls", "risks", "evidence",
      "control_tests", "audit_log", "sessions", "users", "controls",
    ]) {
      await query(`delete from ${t}`);
    }
    await seedControls();
    app = await buildApp();
    await app.ready();

    const boot = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
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

    controlId = (await app.inject({ url: "/api/v1/controls", headers: read() })).json()
      .controls[0].id;

    const risk = await app.inject({
      method: "POST", url: "/api/v1/risks", headers: auth(),
      payload: { title: "Linked risk", likelihood: 3, impact: 3 },
    });
    riskId = risk.json().risk.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("creates an asset, numbers it, and links controls and risks", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/assets", headers: auth(),
      payload: {
        name: "Payroll database", type: "Data / Information",
        category: "Primary asset", criticality: "High", classification: "Confidential",
        owner: "S. Patel", controlIds: [controlId], riskIds: [riskId],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().asset.seq).toBe(1);

    const { assets } = (await app.inject({ url: "/api/v1/assets", headers: read() })).json();
    expect(assets).toHaveLength(1);
    expect(assets[0].control_ids).toEqual([controlId]);
    expect(assets[0].risk_ids).toEqual([riskId]);
    expect(assets[0].attrs).toEqual({});
  });

  it("rejects a classification the schema does not allow", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/assets", headers: auth(),
      payload: { name: "Bad asset", classification: "Top Secret" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("archives the previous version when a policy's version changes", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/policies", headers: auth(),
      payload: { name: "Information Security Policy", version: "1.0", owner: "J. Chen" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().policy.id;

    // An edit that leaves the version alone must not archive anything.
    await app.inject({
      method: "PATCH", url: `/api/v1/policies/${id}`, headers: auth(),
      payload: { owner: "A. Osei" },
    });
    let history = await query("select * from policy_versions where policy_id = $1", [id]);
    expect(history.rows).toHaveLength(0);

    // Changing the version archives the one being replaced.
    const bumped = await app.inject({
      method: "PATCH", url: `/api/v1/policies/${id}`, headers: auth(),
      payload: { version: "2.0", status: "Approved", changeNote: "Annual review" },
    });
    expect(bumped.statusCode).toBe(200);
    expect(bumped.json().policy.version).toBe("2.0");

    history = await query<{ version: string; change_note: string }>(
      "select * from policy_versions where policy_id = $1",
      [id],
    );
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]!.version).toBe("1.0");
    expect(history.rows[0]!.change_note).toBe("Annual review");

    // changeNote describes the change; it must not be stored on the policy.
    const cols = await query<{ name: string }>("select name from pragma_table_info('policies')");
    expect(cols.rows.map((c) => c.name)).not.toContain("change_note");
  });

  /**
   * An approved policy nobody has read is the thing A.5.10 is about, so the
   * evidence has to survive a reissue: acknowledging v1.0 says nothing about
   * v2.0, and the register must not pretend otherwise.
   */
  it("records who has read a policy, against the version they read", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/policies", headers: auth(),
      payload: { name: "Acceptable Use Policy", version: "1.0" },
    });
    const id = created.json().policy.id;

    const first = await app.inject({
      method: "POST", url: `/api/v1/policies/${id}/acknowledgements`, headers: auth(),
      payload: { person: "J. Chen", acknowledgedOn: "2026-01-14" },
    });
    expect(first.statusCode).toBe(201);
    // No version supplied: the one the policy is on is the one that was read.
    expect(first.json().acknowledgement.version).toBe("1.0");

    // The same person twice on the same version is a mistake, not a second fact.
    const again = await app.inject({
      method: "POST", url: `/api/v1/policies/${id}/acknowledgements`, headers: auth(),
      payload: { person: "J. Chen" },
    });
    expect(again.statusCode).toBe(400);

    // Reissue. The old acknowledgement stays, and says which version it was.
    await app.inject({
      method: "PATCH", url: `/api/v1/policies/${id}`, headers: auth(),
      payload: { version: "2.0", changeNote: "Annual review" },
    });
    const afterReissue = await app.inject({
      method: "POST", url: `/api/v1/policies/${id}/acknowledgements`, headers: auth(),
      payload: { person: "J. Chen" },
    });
    expect(afterReissue.statusCode).toBe(201);
    expect(afterReissue.json().acknowledgement.version).toBe("2.0");

    // Both come back on the policy.
    const listed = await app.inject({ url: "/api/v1/policies", headers: read() });
    const policy = listed.json().policies.find((p: { id: string }) => p.id === id);
    expect(policy.acknowledgements).toHaveLength(2);
    expect(policy.acknowledgements.map((a: { version: string }) => a.version).sort())
      .toEqual(["1.0", "2.0"]);

    // Typed the wrong name: it can be withdrawn, and the trail keeps both facts.
    const withdraw = await app.inject({
      method: "DELETE",
      url: `/api/v1/policies/${id}/acknowledgements/${first.json().acknowledgement.id}`,
      headers: auth(),
    });
    expect(withdraw.statusCode).toBe(204);

    const trail = await query<{ action: string }>(
      "select action from audit_log where entity_id = $1",
      [id],
    );
    expect(trail.rows.map((r) => r.action)).toContain("Policy acknowledged");
    expect(trail.rows.map((r) => r.action)).toContain("Policy acknowledgement withdrawn");

    // Deleting the policy takes its acknowledgements with it.
    await app.inject({ method: "DELETE", url: `/api/v1/policies/${id}`, headers: auth() });
    const orphans = await query("select * from policy_acknowledgements where policy_id = $1", [id]);
    expect(orphans.rows).toHaveLength(0);
  });

  it("keeps a task when the control it points at is deleted", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/tasks", headers: auth(),
      payload: { title: "Write the access review procedure", controlId, priority: "High" },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().task.id;

    await query("delete from controls where id = $1", [controlId]);

    const { rows } = await query<{ title: string; control_id: string | null }>(
      "select * from tasks where id = $1",
      [taskId],
    );
    expect(rows[0]!.title).toBe("Write the access review procedure");
    expect(rows[0]!.control_id).toBeNull();

    await seedControls(); // put the pack back for the remaining tests
  });

  it("refuses to close a finding with nothing written down", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/findings", headers: auth(),
      payload: { title: "Access reviews not evidenced", type: "Minor nonconformity" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().finding.id;

    const bad = await app.inject({
      method: "PATCH", url: `/api/v1/findings/${id}`, headers: auth(),
      payload: { status: "Closed" },
    });
    expect(bad.statusCode).toBe(400);

    const good = await app.inject({
      method: "PATCH", url: `/api/v1/findings/${id}`, headers: auth(),
      payload: { status: "Closed", description: "Quarterly review evidenced and signed off." },
    });
    expect(good.statusCode).toBe(200);
  });

  it("records an incident and orders the register by when it was detected", async () => {
    for (const [title, date] of [
      ["Older incident", "2026-01-05"],
      ["Newer incident", "2026-08-20"],
    ]) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/incidents", headers: auth(),
        payload: { title, detectedDate: date, severity: "High", riskIds: [riskId] },
      });
      expect(res.statusCode).toBe(201);
    }
    const { incidents } = (await app.inject({ url: "/api/v1/incidents", headers: read() })).json();
    expect(incidents.map((i: { title: string }) => i.title)).toEqual([
      "Newer incident",
      "Older incident",
    ]);
    expect(incidents[0].risk_ids).toEqual([riskId]);
  });

  it("writes an audit row for every register mutation", async () => {
    const { rows } = await query<{ action: string }>("select action from audit_log");
    const actions = rows.map((r) => r.action);
    for (const expected of [
      "Asset added", "Policy added", "Policy updated",
      "Task added", "Finding added", "Finding updated", "Incident added",
    ]) {
      expect(actions).toContain(expected);
    }
  });

  it("refuses every register write without a CSRF token", async () => {
    for (const path of ["assets", "policies", "tasks", "incidents", "findings"]) {
      const res = await app.inject({
        method: "POST", url: `/api/v1/${path}`, headers: read(),
        payload: { name: "x", title: "x" },
      });
      expect(res.statusCode, path).toBe(403);
    }
  });

  it("refuses every register to an anonymous caller", async () => {
    for (const path of ["assets", "policies", "tasks", "incidents", "findings"]) {
      const res = await app.inject({ url: `/api/v1/${path}` });
      expect(res.statusCode, path).toBe(401);
    }
  });

  it("deletes a register row and cascades its links", async () => {
    const { assets } = (await app.inject({ url: "/api/v1/assets", headers: read() })).json();
    const id = assets[0].id;

    const res = await app.inject({
      method: "DELETE", url: `/api/v1/assets/${id}`, headers: auth(),
    });
    expect(res.statusCode).toBe(204);

    const links = await query("select * from asset_controls where asset_id = $1", [id]);
    expect(links.rows).toHaveLength(0);

    const gone = await app.inject({ url: `/api/v1/assets/${id}`, headers: read() });
    expect(gone.statusCode).toBe(404);
  });
});
