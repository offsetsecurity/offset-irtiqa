import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registerRoutes } from "./register.js";
import { query } from "../db/pool.js";
import { canWrite, requireAuth, assertCanWrite } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { badRequest, notFound } from "../lib/errors.js";

/**
 * The five Phase 3 registers, each one a configuration of the shared CRUD
 * routes in `register.ts`. Field lists follow the standalone HTML tools.
 */

const text = (max: number) => z.string().max(max).default("");
const date = () => z.string().date().nullish();
const ids = () => z.array(z.string().uuid()).default([]);

const controlLink = (self: string, table: string) => ({
  table,
  self,
  other: "control_id",
  input: "controlIds",
  output: "control_ids",
});

const riskLink = (self: string, table: string) => ({
  table,
  self,
  other: "risk_id",
  input: "riskIds",
  output: "risk_ids",
});

// ── assets ───────────────────────────────────────────────────────────────────
export const assetRoutes = registerRoutes({
  table: "assets",
  label: "Asset",
  path: "assets",
  orderBy: "t.criticality = 'High' desc, t.name",
  shape: {
    name: z.string().min(1).max(300),
    type: text(80).default("Software"),
    category: z.enum(["Primary asset", "Supporting asset"]).default("Supporting asset"),
    criticality: z.enum(["High", "Medium", "Low"]).default("Medium"),
    classification: z
      .enum(["Public", "Internal", "Confidential", "Restricted"])
      .default("Internal"),
    owner: text(200),
    location: text(200),
    notes: text(10_000),
    controlIds: ids(),
    riskIds: ids(),
  },
  columns: {
    name: "name", type: "type", category: "category", criticality: "criticality",
    classification: "classification", owner: "owner", location: "location", notes: "notes",
  },
  links: [controlLink("asset_id", "asset_controls"), riskLink("asset_id", "asset_risks")],
});

// ── policies ─────────────────────────────────────────────────────────────────
export const policyRoutes = registerRoutes({
  table: "policies",
  label: "Policy",
  path: "policies",
  orderBy: "t.name",
  shape: {
    name: z.string().min(1).max(300),
    version: text(40).default("1.0"),
    owner: text(200),
    ownerEmail: z.union([z.literal(""), z.string().email("That is not an email address.")]).default(""),
    status: z.enum(["Draft", "In Review", "Approved"]).default("Draft"),
    reviewDate: date(),
    approver: text(200),
    approvalDate: date(),
    notes: text(10_000),
    changeNote: text(500),
    controlIds: ids(),
  },
  columns: {
    name: "name", version: "version", owner: "owner", ownerEmail: "owner_email", status: "status",
    reviewDate: "review_date", approver: "approver", approvalDate: "approval_date",
    notes: "notes",
    // changeNote is deliberately absent: it describes the change, and belongs
    // on the archived version rather than on the policy itself.
  },
  links: [controlLink("policy_id", "policy_controls")],

  // Without this the archive is written and never seen, which is worse than
  // not keeping one. Newest first.
  extraSelect: `(select json_group_array(
                   json_object('version', v.version, 'status', v.status,
                               'approver', v.approver, 'changeNote', v.change_note,
                               'archivedAt', v.archived_at))
                 from (select * from policy_versions
                        where policy_id = t.id
                        order by archived_at desc) v) as versions_json,
                (select json_group_array(
                   json_object('id', a.id, 'person', a.person, 'version', a.version,
                               'acknowledged_on', a.acknowledged_on, 'note', a.note))
                 from (select * from policy_acknowledgements
                        where policy_id = t.id
                        order by acknowledged_on desc, person) a) as acknowledgements_json`,

  /**
   * Document control. Changing the version number archives the version the
   * policy was on before the edit lands, so the history reads as a sequence of
   * issued versions rather than a single row that quietly changed.
   */
  async beforeUpdate(tx, id, body, existing) {
    const next = body["version"];
    if (typeof next !== "string" || next === existing["version"]) return;

    await tx.query(
      `insert into policy_versions (id, policy_id, version, status, approver, change_note)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        id,
        String(existing["version"] ?? ""),
        String(existing["status"] ?? ""),
        String(existing["approver"] ?? ""),
        String(body["changeNote"] ?? ""),
      ],
    );
  },
});

/**
 * Acknowledgements: who has read the policy, and which version they read.
 *
 * Not part of the policy body. A person acknowledging a document is not an
 * edit to the document, and making it one would mean anybody recording a
 * sign-off had to rewrite the policy to do it. It also writes immediately
 * rather than on Save, because it is a fact about a person, not a draft.
 */
const policyId = z.object({ id: z.string().uuid() });
const acknowledgementId = z.object({ id: z.string().uuid(), ackId: z.string().uuid() });

const acknowledgementBody = z
  .object({
    person: z.string().min(1).max(200),
    /** Left out means the version the policy is on now, which is the usual case. */
    version: z.string().max(40).optional(),
    /** Left out means today. Supplied when somebody records a signature from last week. */
    acknowledgedOn: z.string().date().optional(),
    note: z.string().max(500).default(""),
  })
  .strict();

export async function policyAcknowledgementRoutes(app: FastifyInstance): Promise<void> {
  const base = "/api/v1/policies/:id/acknowledgements";

  app.post(base, { preHandler: canWrite }, async (request, reply) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const { id } = policyId.parse(request.params);
    const body = acknowledgementBody.parse(request.body);

    const { rows: found } = await query<{ name: string; version: string }>(
      "select name, version from policies where id = $1",
      [id],
    );
    const policy = found[0];
    if (!policy) throw notFound("Policy not found.");

    const person = body.person.trim();
    if (!person) throw badRequest("Say who acknowledged it.");
    const version = (body.version ?? policy.version).trim();
    const on = body.acknowledgedOn ?? new Date().toISOString().slice(0, 10);

    // Checked here rather than left to the unique index, so the answer is a
    // sentence a person can act on instead of a constraint name.
    const { rows: twice } = await query<{ id: string }>(
      `select id from policy_acknowledgements
        where policy_id = $1 and person = $2 and version = $3`,
      [id, person, version],
    );
    if (twice[0]) {
      throw badRequest(`${person} has already acknowledged v${version} of this policy.`);
    }

    const ackId = randomUUID();
    const { rows } = await query<Record<string, unknown>>(
      `insert into policy_acknowledgements
         (id, policy_id, person, version, acknowledged_on, note)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [ackId, id, person, version, on, body.note],
    );

    await audit(request, {
      action: "Policy acknowledged",
      entity: "policy",
      entityId: id,
      after: { policy: policy.name, person, version, acknowledgedOn: on },
    });
    reply.code(201);
    return { acknowledgement: rows[0] };
  });

  // Removable because it is typed by hand and the wrong name is easy to type.
  // The audit trail keeps the fact that it was recorded and then withdrawn.
  app.delete(`${base}/:ackId`, { preHandler: canWrite }, async (request, reply) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const { id, ackId } = acknowledgementId.parse(request.params);

    const { rows } = await query<Record<string, unknown>>(
      "delete from policy_acknowledgements where id = $1 and policy_id = $2 returning *",
      [ackId, id],
    );
    if (!rows[0]) throw notFound("Acknowledgement not found.");

    await audit(request, {
      action: "Policy acknowledgement withdrawn",
      entity: "policy",
      entityId: id,
      before: rows[0],
    });
    reply.code(204);
  });
}

// ── tasks ────────────────────────────────────────────────────────────────────
export const taskRoutes = registerRoutes({
  table: "tasks",
  label: "Task",
  path: "tasks",
  // Anything still open comes first, oldest deadline at the top; undated last.
  orderBy: "t.status = 'Done', t.due_date is null, t.due_date, t.seq",
  shape: {
    title: z.string().min(1).max(300),
    owner: text(200),
    // Chased only when it also has a date. Empty is the normal state and is
    // never an error: most tasks belong to whoever is in the room.
    ownerEmail: z.union([z.literal(""), z.string().email("That is not an email address.")]).default(""),
    dueDate: date(),
    priority: z.enum(["Low", "Medium", "High"]).default("Medium"),
    status: z.enum(["Open", "In Progress", "Done"]).default("Open"),
    // A planned change to the management system is work with a date and an
    // owner, which is what a task is (6.3). It carries what the change means
    // for security, which is the part an auditor asks about.
    kind: z.enum(["Task", "Change"]).default("Task"),
    securityImpact: text(10_000),
    notes: text(10_000),
    controlId: z.string().uuid().nullish(),
    riskId: z.string().uuid().nullish(),
  },
  columns: {
    title: "title", owner: "owner", ownerEmail: "owner_email",
    dueDate: "due_date", priority: "priority", kind: "kind",
    securityImpact: "security_impact",
    status: "status", notes: "notes", controlId: "control_id", riskId: "risk_id",
  },
  // Single links live in columns, so there is no join table here.
});

// ── incidents ────────────────────────────────────────────────────────────────
export const incidentRoutes = registerRoutes({
  table: "incidents",
  label: "Incident",
  path: "incidents",
  orderBy: "t.detected_date desc, t.seq desc",
  shape: {
    title: z.string().min(1).max(300),
    detectedDate: date(),
    owner: text(200),
    severity: z.enum(["Low", "Medium", "High", "Critical"]).default("Medium"),
    status: z
      .enum(["Open", "Investigating", "Contained", "Resolved", "Closed"])
      .default("Open"),
    description: text(10_000),
    controlIds: ids(),
    riskIds: ids(),
  },
  columns: {
    title: "title", detectedDate: "detected_date", owner: "owner",
    severity: "severity", status: "status", description: "description",
  },
  links: [
    controlLink("incident_id", "incident_controls"),
    riskLink("incident_id", "incident_risks"),
  ],
});

// ── findings ─────────────────────────────────────────────────────────────────
export const findingRoutes = registerRoutes({
  table: "findings",
  label: "Finding",
  path: "findings",
  orderBy: "t.status = 'Closed', t.due_date is null, t.due_date, t.seq",
  shape: {
    title: z.string().min(1).max(300),
    type: text(80).default("Observation"),
    status: z.enum(["Open", "In Progress", "Closed"]).default("Open"),
    source: text(200),
    description: text(10_000),
    clause: text(120),
    owner: text(200),
    dueDate: date(),
    // Corrective action, on the finding rather than in a register of its own:
    // an action without the finding that caused it is an orphan, and two lists
    // that must be kept in step are how they stop being in step.
    rootCause: text(2000),
    actionTaken: text(2000),
    verification: text(2000),
    verifiedBy: text(200),
    verifiedDate: date(),
    controlIds: ids(),
  },
  columns: {
    title: "title", type: "type", status: "status", source: "source",
    description: "description", clause: "clause", owner: "owner", dueDate: "due_date",
    rootCause: "root_cause", actionTaken: "action_taken", verification: "verification",
    verifiedBy: "verified_by", verifiedDate: "verified_date",
  },
  links: [controlLink("finding_id", "finding_controls")],

  /**
   * A finding that is closed should say what closed it. The tools let this
   * slide; an assessor will not.
   */
  validate(body, existing) {
    const status = body["status"] ?? existing?.["status"];
    const description = body["description"] ?? existing?.["description"] ?? "";
    if (status === "Closed" && !String(description).trim()) {
      throw badRequest("A closed finding needs a description of what was done.");
    }
  },
});
