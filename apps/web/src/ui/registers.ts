import { html } from "./html.js";
import type { RegisterSpec } from "./Register.js";
import { assets, policies, tasks, incidents, findings, type RegisterRow } from "../persistence/apiClient.js";
import { localDay } from "./format.js";
import { ASSET_TYPES, CRITICALITY, CLASSIFICATION, POLICY_STATUS, TASK_PRIORITY, TASK_STATUS, TASK_KINDS, SEVERITY, INCIDENT_STATUS, FINDING_STATUS, FINDING_TYPES, badge, plain, titleCell, dueCell } from "./registers-shared.js";
export { vendorRegister } from "./registers-management.js";
export { trainingRegister } from "./registers-management.js";
export { objectiveRegister } from "./registers-management.js";
export { communicationRegister } from "./registers-management.js";
export { partyRegister } from "./registers-management.js";
export { reviewRegister } from "./registers-management.js";

/**
 * The five Phase 3 registers, as configuration for `Register.ts`.
 * Field lists follow the standalone HTML tools.
 */

// ── assets ───────────────────────────────────────────────────────────────────
export const assetRegister: RegisterSpec<RegisterRow> = {
  api: assets,
  attachTo: "assets",
  singular: "Asset",
  plural: "Assets",
  searchText: (r) => `${r["name"]} ${r["type"]} ${r["owner"]} ${r["location"]}`,
  filters: [
    { key: "criticality", label: "All criticalities", options: CRITICALITY },
    { key: "classification", label: "All classifications", options: CLASSIFICATION },
  ],
  columns: [
    { ...titleCell((r) => r["name"], (r) => `${r["type"]} · ${r["category"]}`), header: "Asset" },
    { header: "Criticality", width: "110px", cell: (r) => badge(r["criticality"]) },
    { header: "Classification", width: "130px", cell: (r) => badge(r["classification"]) },
    { header: "Owner", width: "140px", cell: (r) => plain(r["owner"]) },
    { header: "Linked", width: "80px", cell: (r) =>
      ((r["control_ids"] as string[])?.length ?? 0) + ((r["risk_ids"] as string[])?.length ?? 0) || "—" },
  ],
  fields: [
    { key: "name", label: "Asset name", kind: "text", wide: true, required: true },
    { key: "type", label: "Type", kind: "select", options: ASSET_TYPES },
    { key: "category", label: "Category", kind: "select", options: ["Primary asset", "Supporting asset"] },
    { key: "criticality", label: "Criticality", kind: "select", options: CRITICALITY,
      hint: "How much would losing it hurt?" },
    { key: "classification", label: "Data classification", kind: "select", options: CLASSIFICATION },
    { key: "owner", label: "Owner", kind: "text" },
    { key: "location", label: "Location / hosting", kind: "text" },
    { key: "notes", label: "Notes", kind: "textarea", wide: true },
    { key: "controlIds", label: "Protected by", kind: "links", source: "controls", wide: true },
    { key: "riskIds", label: "Exposed to", kind: "links", source: "risks", wide: true },
  ],
  blank: () => ({
    name: "", type: "Software", category: "Supporting asset", criticality: "Medium",
    classification: "Internal", owner: "", location: "", notes: "",
    controlIds: [], riskIds: [],
  }),
  toInput: (r) => ({
    name: r["name"], type: r["type"], category: r["category"], criticality: r["criticality"],
    classification: r["classification"], owner: r["owner"], location: r["location"],
    notes: r["notes"], controlIds: r["control_ids"] ?? [], riskIds: r["risk_ids"] ?? [],
  }),
};

// ── policies ─────────────────────────────────────────────────────────────────
export const policyRegister: RegisterSpec<RegisterRow> = {
  api: policies,
  attachTo: "policies",
  singular: "Policy",
  plural: "Policies",
  searchText: (r) => `${r["name"]} ${r["owner"]} ${r["approver"]}`,
  filters: [{ key: "status", label: "All statuses", options: POLICY_STATUS }],
  columns: [
    { ...titleCell((r) => r["name"], (r) => `v${r["version"]}${r["approver"] ? ` · approved by ${r["approver"]}` : ""}`),
      header: "Policy" },
    { header: "Status", width: "120px", cell: (r) => badge(r["status"]) },
    { header: "Owner", width: "150px", cell: (r) => plain(r["owner"]) },
    { ...dueCell("review_date", () => false), header: "Next review" },
    // An approved policy nobody has read is the gap this column exposes. It
    // counts the version in force: sign-offs on an older one do not carry over.
    { header: "Read by", width: "90px", align: "right",
      cell: (r) => {
        const all = (r["acknowledgements"] as { version: string }[] | undefined) ?? [];
        const read = all.filter((a) => a.version === r["version"]).length;
        return read ? String(read) : "—";
      } },
  ],
  fields: [
    { key: "name", label: "Policy name", kind: "text", wide: true, required: true },
    { key: "version", label: "Version", kind: "text",
      hint: "Change this and the previous version is archived first." },
    { key: "owner", label: "Owner", kind: "text" },
    { key: "ownerEmail", label: "Email reminders to", kind: "text",
      hint: "When the date comes, this address gets a reminder. Leave empty for none." },
    { key: "status", label: "Status", kind: "select", options: POLICY_STATUS },
    { key: "reviewDate", label: "Next review", kind: "date" },
    { key: "approver", label: "Approver", kind: "text" },
    { key: "approvalDate", label: "Approval date", kind: "date" },
    { key: "changeNote", label: "What changed in this version", kind: "text", wide: true,
      hint: "Recorded against the archived version, not the policy." },
    { key: "notes", label: "Notes", kind: "textarea", wide: true },
    { key: "controlIds", label: "Documents which controls", kind: "links", source: "controls", wide: true },
    { key: "versions", label: "Version history", kind: "history", wide: true },
    { key: "acknowledgements", label: "Who has acknowledged it", kind: "acknowledgements",
      wide: true,
      hint: "Saved straight away, against the version the policy is on. " +
            "This is the staff acceptance A.5.10 asks for." },
  ],
  blank: () => ({
    name: "", version: "1.0", owner: "", ownerEmail: "", status: "Draft", reviewDate: null,
    approver: "", approvalDate: null, changeNote: "Initial issue", notes: "", controlIds: [],
  }),
  toInput: (r) => ({
    name: r["name"], version: r["version"], owner: r["owner"],
    ownerEmail: r["owner_email"] ?? "", status: r["status"],
    reviewDate: r["review_date"], approver: r["approver"], approvalDate: r["approval_date"],
    changeNote: "", notes: r["notes"], controlIds: r["control_ids"] ?? [],
    versions: r["versions"] ?? [], acknowledgements: r["acknowledgements"] ?? [],
  }),
};

// ── tasks ────────────────────────────────────────────────────────────────────
export const taskRegister: RegisterSpec<RegisterRow> = {
  api: tasks,
  attachTo: "tasks",
  singular: "Task",
  plural: "Tasks",
  searchText: (r) => `${r["title"]} ${r["owner"]}`,
  filters: [
    { key: "status", label: "All statuses", options: TASK_STATUS },
    { key: "priority", label: "All priorities", options: TASK_PRIORITY },
    { key: "kind", label: "Work and changes", options: TASK_KINDS },
  ],
  columns: [
    { ...titleCell((r) => r["title"], (r) => String(r["notes"] ?? "")), header: "Task" },
    { header: "Kind", width: "90px", cell: (r) => (r["kind"] === "Change" ? badge("Change") : plain("")) },
    { header: "Priority", width: "100px", cell: (r) => badge(r["priority"]) },
    { header: "Status", width: "120px", cell: (r) => badge(r["status"]) },
    { header: "Owner", width: "140px", cell: (r) => plain(r["owner"]) },
    dueCell("due_date", (r) => r["status"] === "Done"),
  ],
  fields: [
    { key: "title", label: "Task", kind: "text", wide: true, required: true },
    { key: "owner", label: "Owner", kind: "text" },
    { key: "dueDate", label: "Due date", kind: "date" },
    { key: "ownerEmail", label: "Email reminders to", kind: "text",
      hint: "With a due date, this person is emailed three days before, on the day, and while it stays open." },
    { key: "priority", label: "Priority", kind: "select", options: TASK_PRIORITY },
    { key: "status", label: "Status", kind: "select", options: TASK_STATUS },
    { key: "kind", label: "Kind", kind: "select", options: TASK_KINDS,
      hint: "A change to the way you work, or to a system, rather than a piece of work to finish." },
    { key: "securityImpact", label: "What this change means for security", kind: "textarea", wide: true,
      hint: "For a change: what it affects, what could go wrong, and what you will do about it." },
    { key: "controlId", label: "Implements which control", kind: "link", source: "controls", wide: true },
    { key: "riskId", label: "Treats which risk", kind: "link", source: "risks", wide: true },
    { key: "notes", label: "Notes", kind: "textarea", wide: true },
  ],
  blank: () => ({
    title: "", owner: "", ownerEmail: "", dueDate: null, priority: "Medium", status: "Open",
    kind: "Task", securityImpact: "", controlId: null, riskId: null, notes: "",
  }),
  toInput: (r) => ({
    title: r["title"], owner: r["owner"], dueDate: r["due_date"], priority: r["priority"],
    status: r["status"], kind: r["kind"], securityImpact: r["security_impact"],
    controlId: r["control_id"], riskId: r["risk_id"], notes: r["notes"],
  }),
};

// ── incidents ────────────────────────────────────────────────────────────────
export const incidentRegister: RegisterSpec<RegisterRow> = {
  api: incidents,
  attachTo: "incidents",
  singular: "Incident",
  plural: "Incidents",
  searchText: (r) => `${r["title"]} ${r["owner"]} ${r["description"]}`,
  filters: [
    { key: "severity", label: "All severities", options: SEVERITY },
    { key: "status", label: "All statuses", options: INCIDENT_STATUS },
  ],
  columns: [
    { ...titleCell((r) => r["title"], (r) => String(r["description"] ?? "").slice(0, 90)),
      header: "Incident" },
    { header: "Severity", width: "100px", cell: (r) => badge(r["severity"]) },
    { header: "Status", width: "130px", cell: (r) => badge(r["status"]) },
    { header: "Owner", width: "140px", cell: (r) => plain(r["owner"]) },
    { header: "Detected", width: "110px", cell: (r) => plain(r["detected_date"]) },
  ],
  fields: [
    { key: "title", label: "Incident", kind: "text", wide: true, required: true },
    { key: "detectedDate", label: "Date detected", kind: "date" },
    { key: "owner", label: "Owner", kind: "text" },
    { key: "severity", label: "Severity", kind: "select", options: SEVERITY },
    { key: "status", label: "Status", kind: "select", options: INCIDENT_STATUS },
    { key: "description", label: "Description and impact", kind: "textarea", wide: true },
    { key: "controlIds", label: "Which controls were involved", kind: "links", source: "controls", wide: true },
    { key: "riskIds", label: "Which risks it realised", kind: "links", source: "risks", wide: true },
  ],
  blank: () => ({
    title: "", detectedDate: localDay(), owner: "",
    severity: "Medium", status: "Open", description: "", controlIds: [], riskIds: [],
  }),
  toInput: (r) => ({
    title: r["title"], detectedDate: r["detected_date"], owner: r["owner"],
    severity: r["severity"], status: r["status"], description: r["description"],
    controlIds: r["control_ids"] ?? [], riskIds: r["risk_ids"] ?? [],
  }),
};

// ── findings ─────────────────────────────────────────────────────────────────
export const findingRegister: RegisterSpec<RegisterRow> = {
  api: findings,
  attachTo: "findings",
  singular: "Finding",
  plural: "Findings",
  searchText: (r) => `${r["title"]} ${r["owner"]} ${r["clause"]} ${r["source"]}`,
  filters: [
    { key: "status", label: "All statuses", options: FINDING_STATUS },
    { key: "type", label: "All types", options: FINDING_TYPES },
  ],
  columns: [
    { ...titleCell((r) => r["title"], (r) => [r["type"], r["source"]].filter(Boolean).join(" · ")),
      header: "Finding" },
    { header: "Status", width: "120px", cell: (r) => badge(r["status"]) },
    { header: "Reference", width: "110px", cell: (r) => plain(r["clause"]) },
    { header: "Owner", width: "140px", cell: (r) => plain(r["owner"]) },
    { ...dueCell("due_date", (r) => r["status"] === "Closed"), header: "Close by" },
  ],
  fields: [
    { key: "title", label: "Finding", kind: "text", wide: true, required: true },
    { key: "type", label: "Type", kind: "select", options: FINDING_TYPES },
    { key: "status", label: "Status", kind: "select", options: FINDING_STATUS },
    { key: "source", label: "Raised by", kind: "text", hint: "Internal audit, certification body, customer…" },
    { key: "clause", label: "Control reference", kind: "text" },
    { key: "owner", label: "Owner", kind: "text" },
    { key: "dueDate", label: "Close by", kind: "date" },
    { key: "description", label: "Description and what was done", kind: "textarea", wide: true,
      hint: "Required before a finding can be closed." },
    { key: "controlIds", label: "Against which controls", kind: "links", source: "controls", wide: true },
  ],
  blank: () => ({
    title: "", type: "Observation", status: "Open", source: "", clause: "",
    owner: "", dueDate: null, description: "", controlIds: [],
  }),
  toInput: (r) => ({
    title: r["title"], type: r["type"], status: r["status"], source: r["source"],
    clause: r["clause"], owner: r["owner"], dueDate: r["due_date"],
    description: r["description"], controlIds: r["control_ids"] ?? [],
  }),
  // The server refuses this too; saying so here explains it next to the field.
  validate: (d) =>
    d["status"] === "Closed" && !String(d["description"] ?? "").trim()
      ? "A closed finding needs a description of what was done."
      : null,
};

/**
 * The same register, with the corrective action fields clause 10.2 asks for.
 *
 * They live on the finding rather than in a list of their own: a corrective
 * action without the finding that caused it is an orphan, and two lists that
 * have to be kept in step are how they stop being in step.
 */
export const findingRegisterWithCorrectiveAction: RegisterSpec<RegisterRow> = {
  ...findingRegister,
  fields: [
    ...findingRegister.fields,
    { key: "rootCause", label: "Root cause", kind: "textarea", wide: true,
      hint: "Why it happened, not what happened. \"Nobody owned the review\" is a cause; \"the review was late\" is not." },
    { key: "actionTaken", label: "Corrective action", kind: "textarea", wide: true,
      hint: "What you changed so it does not happen again." },
    { key: "verification", label: "How you checked it worked", kind: "textarea", wide: true },
    { key: "verifiedBy", label: "Checked by", kind: "text" },
    { key: "verifiedDate", label: "Checked on", kind: "date" },
  ],
  blank: () => ({
    ...findingRegister.blank(),
    rootCause: "", actionTaken: "", verification: "", verifiedBy: "", verifiedDate: null,
  }),
  toInput: (r) => ({
    ...findingRegister.toInput(r),
    rootCause: r["root_cause"], actionTaken: r["action_taken"],
    verification: r["verification"], verifiedBy: r["verified_by"],
    verifiedDate: r["verified_date"],
  }),
  columns: [
    ...findingRegister.columns.slice(0, 2),
    {
      header: "Fixed",
      width: "110px",
      cell: (r) =>
        String(r["verified_date"] ?? "").trim()
          ? html`<span class="pill green">Checked</span>`
          : String(r["action_taken"] ?? "").trim()
          ? html`<span class="pill amber">Acted on</span>`
          : html`<span class="muted">—</span>`,
    },
    ...findingRegister.columns.slice(2),
  ],
};

