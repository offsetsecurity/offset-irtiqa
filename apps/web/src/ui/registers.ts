import type { VNode } from "preact";
import { html } from "./html.js";
import type { RegisterSpec, ColumnSpec } from "./Register.js";
import {
  assets, policies, tasks, incidents, findings, vendors, training, objectives, parties,
  reviews, communications, type RegisterRow,
} from "../persistence/apiClient.js";

/**
 * The five Phase 3 registers, as configuration for `Register.ts`.
 * Field lists follow the standalone HTML tools.
 */

const ASSET_TYPES = [
  "Cloud Provider", "SaaS", "Software", "Hardware", "Service",
  "Data / Information", "Information Asset", "Business Process", "People", "Facility",
] as const;
const CRITICALITY = ["High", "Medium", "Low"] as const;
const CLASSIFICATION = ["Public", "Internal", "Confidential", "Restricted"] as const;
const POLICY_STATUS = ["Draft", "In Review", "Approved"] as const;
const TASK_PRIORITY = ["Low", "Medium", "High"] as const;
const TASK_STATUS = ["Open", "In Progress", "Done"] as const;
/** A planned change to the way you work is tracked as work, not as a second list. */
const TASK_KINDS = ["Task", "Change"] as const;
const SEVERITY = ["Low", "Medium", "High", "Critical"] as const;
const INCIDENT_STATUS = ["Open", "Investigating", "Contained", "Resolved", "Closed"] as const;
const FINDING_STATUS = ["Open", "In Progress", "Closed"] as const;
const VENDOR_STATUS = ["Prospective", "Active", "Under review", "Exited"] as const;
const TRAINING_RESULT = ["Completed", "In progress", "Not started", "Failed"] as const;
const OBJECTIVE_STATUS = ["Planned", "On track", "At risk", "Met", "Missed"] as const;
const PARTY_KINDS = [
  "Customer", "Regulator", "Staff", "Supplier", "Owner or investor", "Partner", "Other",
] as const;
const REVIEW_KINDS = [
  "Internal audit", "Management review", "External audit", "Supplier audit",
] as const;
const REVIEW_STATUS = ["Planned", "In progress", "Completed", "Cancelled"] as const;

const FINDING_TYPES = [
  "Observation", "Opportunity for improvement", "Minor nonconformity", "Major nonconformity",
] as const;

const TONE: Record<string, string> = {
  High: "#dc2626", Critical: "#dc2626", Medium: "#d97706", Low: "#16a34a",
  Restricted: "#dc2626", Confidential: "#d97706", Internal: "#475569", Public: "#16a34a",
  Open: "#d97706", "In Progress": "#2457D6", Investigating: "#2457D6", Contained: "#0891b2",
  Done: "#16a34a", Closed: "#16a34a", Resolved: "#16a34a", Approved: "#16a34a",
  Draft: "#475569", "In Review": "#2457D6",
  Active: "#16a34a", Prospective: "#475569", "Under review": "#d97706", Exited: "#475569",
  Completed: "#16a34a", "Not started": "#475569", Failed: "#dc2626",
  Planned: "#475569", "On track": "#16a34a", "At risk": "#d97706", Met: "#16a34a",
  Missed: "#dc2626", Cancelled: "#475569",
};

const badge = (value: unknown): VNode => {
  const text = String(value ?? "—");
  const colour = TONE[text] ?? "#475569";
  return html`<span class="pill" style=${`background:${colour}1a;color:${colour}`}>${text}</span>`;
};

const plain = (value: unknown): string => {
  const text = String(value ?? "").trim();
  return text === "" ? "—" : text;
};

/** Title on the first line, a quieter detail line under it. */
const titleCell = <T extends RegisterRow>(
  title: (r: T) => unknown,
  detail: (r: T) => string,
): ColumnSpec<T> => ({
  header: "",
  cell: (r) => html`
    <div>${String(title(r) ?? "")}</div>
    <div class="muted" style="font-size:11.5px">${detail(r)}</div>`,
});

/** Overdue dates are the only thing on these screens that should shout. */
const dueCell = <T extends RegisterRow>(key: string, doneWhen: (r: T) => boolean): ColumnSpec<T> => ({
  header: "Due",
  width: "110px",
  cell: (r) => {
    const value = r[key] as string | null;
    if (!value) return html`<span class="muted">—</span>`;
    const overdue = !doneWhen(r) && value < new Date().toISOString().slice(0, 10);
    return overdue
      ? html`<span style="color:var(--red);font-weight:700">${value}</span>`
      : html`<span class="muted">${value}</span>`;
  },
});

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
    { ...dueCell("review_date", (r) => false), header: "Next review" },
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
    title: "", detectedDate: new Date().toISOString().slice(0, 10), owner: "",
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

// ── the management-system registers (Offset Assure) ──────────────────────────

/**
 * Five registers ISO 27001 asks for by name. Each is configuration, like the
 * five before it; what makes them different is the words, and the words are
 * the point: an auditor asks for "the interested parties" and expects to be
 * shown something called that.
 */

export const vendorRegister: RegisterSpec<RegisterRow> = {
  api: vendors,
  attachTo: "vendors",
  singular: "Supplier",
  plural: "Suppliers",
  searchText: (r) => `${r["name"]} ${r["service"]} ${r["owner"]} ${r["assurance"]}`,
  filters: [
    { key: "criticality", label: "All criticalities", options: CRITICALITY },
    { key: "status", label: "All statuses", options: VENDOR_STATUS },
  ],
  columns: [
    { ...titleCell((r) => r["name"], (r) => String(r["service"] ?? "")), header: "Supplier" },
    { header: "Criticality", width: "110px", cell: (r) => badge(r["criticality"]) },
    { header: "Data", width: "120px", cell: (r) => badge(r["classification"]) },
    { header: "Status", width: "120px", cell: (r) => badge(r["status"]) },
    { header: "Assurance", cell: (r) => plain(r["assurance"]) },
    { ...dueCell("review_date", (r) => r["status"] === "Exited"), header: "Review by" },
  ],
  fields: [
    { key: "name", label: "Supplier", kind: "text", wide: true, required: true },
    { key: "service", label: "What they do for you", kind: "text", wide: true },
    { key: "criticality", label: "Criticality", kind: "select", options: CRITICALITY },
    { key: "classification", label: "Most sensitive data they hold", kind: "select", options: CLASSIFICATION },
    { key: "status", label: "Status", kind: "select", options: VENDOR_STATUS },
    { key: "owner", label: "Owner here", kind: "text" },
    { key: "ownerEmail", label: "Email reminders to", kind: "text",
      hint: "When the date comes, this address gets a reminder. Leave empty for none." },
    { key: "assessedDate", label: "Last assessed", kind: "date" },
    { key: "reviewDate", label: "Review by", kind: "date" },
    { key: "assurance", label: "Assurance they gave", kind: "text", wide: true,
      hint: "An ISO 27001 certificate, a SOC 2 report, a questionnaire, a penetration test…" },
    { key: "notes", label: "Notes", kind: "textarea", wide: true },
    { key: "controlIds", label: "Controls this supports", kind: "links", source: "controls", wide: true },
    { key: "riskIds", label: "Risks it carries", kind: "links", source: "risks", wide: true },
  ],
  blank: () => ({
    name: "", service: "", criticality: "Medium", classification: "Internal",
    status: "Prospective", owner: "", ownerEmail: "", assessedDate: null, reviewDate: null,
    assurance: "", notes: "", controlIds: [], riskIds: [],
  }),
  toInput: (r) => ({
    name: r["name"], service: r["service"], criticality: r["criticality"],
    classification: r["classification"], status: r["status"], owner: r["owner"],
    ownerEmail: r["owner_email"] ?? "",
    assessedDate: r["assessed_date"], reviewDate: r["review_date"],
    assurance: r["assurance"], notes: r["notes"],
    controlIds: r["control_ids"] ?? [], riskIds: r["risk_ids"] ?? [],
  }),
};

export const trainingRegister: RegisterSpec<RegisterRow> = {
  api: training,
  attachTo: "training",
  singular: "Training record",
  plural: "Training",
  searchText: (r) => `${r["person"]} ${r["course"]} ${r["audience"]}`,
  filters: [{ key: "result", label: "All results", options: TRAINING_RESULT }],
  columns: [
    { ...titleCell((r) => r["person"], (r) => String(r["course"] ?? "")), header: "Person" },
    { header: "Audience", width: "150px", cell: (r) => plain(r["audience"]) },
    { header: "Result", width: "120px", cell: (r) => badge(r["result"]) },
    { header: "Completed", width: "110px", cell: (r) => plain(r["completed_date"]) },
    { ...dueCell("next_due", (r) => r["result"] === "Not started"), header: "Due again" },
  ],
  fields: [
    { key: "person", label: "Person", kind: "text", required: true },
    { key: "ownerEmail", label: "Their email, for reminders", kind: "text",
      hint: "When training is due again, this address gets a reminder. Leave empty for none." },
    { key: "course", label: "Training", kind: "text", wide: true,
      hint: "Induction, annual awareness, phishing, secure development…" },
    { key: "audience", label: "Group", kind: "text", hint: "Everyone, developers, new starters…" },
    { key: "result", label: "Result", kind: "select", options: TRAINING_RESULT },
    { key: "completedDate", label: "Completed", kind: "date" },
    { key: "nextDue", label: "Due again", kind: "date" },
    { key: "notes", label: "Notes", kind: "textarea", wide: true },
    { key: "controlIds", label: "Controls this proves", kind: "links", source: "controls", wide: true },
  ],
  blank: () => ({
    person: "", ownerEmail: "", course: "", audience: "", result: "Completed",
    completedDate: null, nextDue: null, notes: "", controlIds: [],
  }),
  toInput: (r) => ({
    person: r["person"], ownerEmail: r["owner_email"] ?? "", course: r["course"],
    audience: r["audience"], result: r["result"],
    completedDate: r["completed_date"], nextDue: r["next_due"], notes: r["notes"],
    controlIds: r["control_ids"] ?? [],
  }),
};

export const objectiveRegister: RegisterSpec<RegisterRow> = {
  api: objectives,
  attachTo: "objectives",
  singular: "Objective",
  plural: "Objectives",
  searchText: (r) => `${r["title"]} ${r["measure"]} ${r["owner"]}`,
  filters: [{ key: "status", label: "All statuses", options: OBJECTIVE_STATUS }],
  columns: [
    { ...titleCell((r) => r["title"], (r) => String(r["measure"] ?? "")), header: "Objective" },
    { header: "Target", width: "120px", cell: (r) => plain(r["target"]) },
    { header: "Status", width: "110px", cell: (r) => badge(r["status"]) },
    { header: "Owner", width: "140px", cell: (r) => plain(r["owner"]) },
    { ...dueCell("due_date", (r) => r["status"] === "Met" || r["status"] === "Missed"), header: "By when" },
  ],
  fields: [
    { key: "title", label: "Objective", kind: "text", wide: true, required: true,
      hint: "Something you can be judged against, such as \"every leaver loses access within a working day\"." },
    { key: "measure", label: "How it is measured", kind: "text", wide: true },
    { key: "target", label: "Target", kind: "text", hint: "100%, under 5, monthly…" },
    { key: "owner", label: "Owner", kind: "text" },
    { key: "ownerEmail", label: "Email reminders to", kind: "text",
      hint: "When the date comes, this address gets a reminder. Leave empty for none." },
    { key: "dueDate", label: "By when", kind: "date" },
    { key: "status", label: "Status", kind: "select", options: OBJECTIVE_STATUS },
    { key: "notes", label: "Notes", kind: "textarea", wide: true },
    { key: "controlIds", label: "Controls it depends on", kind: "links", source: "controls", wide: true },
    { key: "riskIds", label: "Risks it addresses", kind: "links", source: "risks", wide: true },
  ],
  blank: () => ({
    title: "", measure: "", target: "", owner: "", ownerEmail: "", dueDate: null,
    status: "Planned", notes: "", controlIds: [], riskIds: [],
  }),
  toInput: (r) => ({
    title: r["title"], measure: r["measure"], target: r["target"], owner: r["owner"],
    ownerEmail: r["owner_email"] ?? "",
    dueDate: r["due_date"], status: r["status"], notes: r["notes"],
    controlIds: r["control_ids"] ?? [], riskIds: r["risk_ids"] ?? [],
  }),
};

/**
 * Communication (7.4): who is told what about security, when, by whom and how.
 *
 * A plan rather than a log. The question an auditor asks is what you arranged
 * to communicate and to whom; a folder of sent emails does not answer it.
 */
export const communicationRegister: RegisterSpec<RegisterRow> = {
  api: communications,
  attachTo: "communications",
  singular: "Communication",
  plural: "Communications",
  searchText: (r) => `${r["topic"]} ${r["audience"]} ${r["owner"]} ${r["channel"]}`,
  columns: [
    { ...titleCell((r) => r["topic"], (r) => String(r["channel"] ?? "")), header: "What is communicated" },
    { header: "To whom", cell: (r) => plain(r["audience"]) },
    { header: "How often", width: "140px", cell: (r) => plain(r["frequency"]) },
    { header: "Owner", width: "140px", cell: (r) => plain(r["owner"]) },
    // Never crossed out: a communication arrangement repeats, it is not finished.
    dueCell("next_due", () => false),
  ],
  fields: [
    { key: "topic", label: "What is communicated", kind: "text", wide: true, required: true,
      hint: "For example: the security policy, phishing reminders, incident reporting, supplier duties." },
    { key: "audience", label: "To whom", kind: "text", hint: "All staff, new starters, the board, a supplier." },
    { key: "owner", label: "Who does it", kind: "text" },
    { key: "ownerEmail", label: "Email reminders to", kind: "text",
      hint: "When the date comes, this address gets a reminder. Leave empty for none." },
    { key: "channel", label: "How", kind: "text", hint: "Email, the intranet, an induction session, a newsletter." },
    { key: "frequency", label: "How often", kind: "text", hint: "Yearly, quarterly, on joining, after every incident." },
    { key: "lastSent", label: "Last done", kind: "date" },
    { key: "nextDue", label: "Next due", kind: "date",
      hint: "Put a date here and it appears in the calendar." },
    { key: "notes", label: "Notes", kind: "textarea", wide: true },
    { key: "controlIds", label: "Controls it supports", kind: "links", source: "controls", wide: true },
  ],
  blank: () => ({
    topic: "", audience: "", owner: "", ownerEmail: "", channel: "", frequency: "",
    lastSent: null, nextDue: null, notes: "", controlIds: [],
  }),
  toInput: (r) => ({
    topic: r["topic"], audience: r["audience"], owner: r["owner"],
    ownerEmail: r["owner_email"] ?? "", channel: r["channel"],
    frequency: r["frequency"], lastSent: r["last_sent"], nextDue: r["next_due"],
    notes: r["notes"], controlIds: r["control_ids"] ?? [],
  }),
};

export const partyRegister: RegisterSpec<RegisterRow> = {
  api: parties,
  attachTo: "parties",
  singular: "Interested party",
  plural: "Interested parties",
  searchText: (r) => `${r["name"]} ${r["kind"]} ${r["needs"]} ${r["addressed"]}`,
  filters: [{ key: "kind", label: "All kinds", options: PARTY_KINDS }],
  columns: [
    { ...titleCell((r) => r["name"], (r) => String(r["kind"] ?? "")), header: "Who" },
    { header: "What they need", cell: (r) => plain(r["needs"]) },
    { header: "How you meet it", cell: (r) => plain(r["addressed"]) },
    { header: "Owner", width: "140px", cell: (r) => plain(r["owner"]) },
    { ...dueCell("review_date", () => false), header: "Review by" },
  ],
  fields: [
    { key: "name", label: "Who", kind: "text", required: true,
      hint: "A customer, your regulator, staff, a supplier, an owner." },
    { key: "kind", label: "Kind", kind: "select", options: PARTY_KINDS },
    { key: "needs", label: "What they need from you", kind: "textarea", wide: true },
    { key: "addressed", label: "How you meet it", kind: "textarea", wide: true },
    { key: "owner", label: "Owner", kind: "text" },
    { key: "ownerEmail", label: "Email reminders to", kind: "text",
      hint: "When the date comes, this address gets a reminder. Leave empty for none." },
    { key: "reviewDate", label: "Review by", kind: "date",
      hint: "Their needs change. Clause 9.3 asks for those changes at every management review." },
    { key: "notes", label: "Notes", kind: "textarea", wide: true },
    { key: "controlIds", label: "Controls that answer it", kind: "links", source: "controls", wide: true },
  ],
  blank: () => ({
    name: "", kind: "Customer", needs: "", addressed: "", owner: "", ownerEmail: "",
    reviewDate: null, notes: "", controlIds: [],
  }),
  toInput: (r) => ({
    name: r["name"], kind: r["kind"], needs: r["needs"], addressed: r["addressed"],
    owner: r["owner"], ownerEmail: r["owner_email"] ?? "", reviewDate: r["review_date"],
    notes: r["notes"], controlIds: r["control_ids"] ?? [],
  }),
};

export const reviewRegister: RegisterSpec<RegisterRow> = {
  api: reviews,
  attachTo: "reviews",
  singular: "Audit or review",
  plural: "Audits and reviews",
  searchText: (r) => `${r["title"]} ${r["kind"]} ${r["led_by"]} ${r["scope"]} ${r["outcome"]}`,
  filters: [
    { key: "kind", label: "All kinds", options: REVIEW_KINDS },
    { key: "status", label: "All statuses", options: REVIEW_STATUS },
  ],
  columns: [
    { ...titleCell((r) => r["title"], (r) => String(r["scope"] ?? "")), header: "Audit or review" },
    { header: "Kind", width: "150px", cell: (r) => plain(r["kind"]) },
    { header: "Status", width: "110px", cell: (r) => badge(r["status"]) },
    { header: "Led by", width: "140px", cell: (r) => plain(r["led_by"]) },
    { header: "Held", width: "100px", cell: (r) => plain(r["held_date"]) },
    { ...dueCell("planned_date", (r) => r["status"] === "Completed" || r["status"] === "Cancelled"),
      header: "Planned" },
  ],
  fields: [
    { key: "title", label: "Audit or review", kind: "text", wide: true, required: true },
    { key: "kind", label: "Kind", kind: "select", options: REVIEW_KINDS },
    { key: "status", label: "Status", kind: "select", options: REVIEW_STATUS },
    { key: "plannedDate", label: "Planned for", kind: "date",
      hint: "A planned audit with a date is your audit programme (clause 9.2)." },
    { key: "heldDate", label: "Held on", kind: "date" },
    { key: "ledBy", label: "Led by", kind: "text" },
    { key: "ownerEmail", label: "Email reminders to", kind: "text",
      hint: "When the date comes, this address gets a reminder. Leave empty for none." },
    { key: "attendees", label: "Who took part", kind: "text", wide: true },
    { key: "scope", label: "Scope", kind: "textarea", wide: true },
    { key: "outcome", label: "Outcome and decisions", kind: "textarea", wide: true,
      hint: "For a management review, the decisions taken. Raise anything found in Findings." },
    { key: "notes", label: "Notes", kind: "textarea", wide: true },
    { key: "controlIds", label: "Controls covered", kind: "links", source: "controls", wide: true },
  ],
  blank: () => ({
    title: "", kind: "Internal audit", status: "Planned", plannedDate: null, heldDate: null,
    ledBy: "", ownerEmail: "", attendees: "", scope: "", outcome: "", notes: "", controlIds: [],
  }),
  toInput: (r) => ({
    title: r["title"], kind: r["kind"], status: r["status"], plannedDate: r["planned_date"],
    heldDate: r["held_date"], ledBy: r["led_by"], ownerEmail: r["owner_email"] ?? "",
    attendees: r["attendees"], scope: r["scope"],
    outcome: r["outcome"], notes: r["notes"], controlIds: r["control_ids"] ?? [],
  }),
  validate: (d) =>
    d["status"] === "Completed" && !String(d["heldDate"] ?? "").trim()
      ? "A completed audit or review needs the date it was held."
      : null,
};
