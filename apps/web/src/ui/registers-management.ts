import type { RegisterSpec } from "./Register.js";
import { vendors, training, objectives, parties, reviews, communications, type RegisterRow } from "../persistence/apiClient.js";
import { CRITICALITY, CLASSIFICATION, VENDOR_STATUS, TRAINING_RESULT, OBJECTIVE_STATUS, PARTY_KINDS, REVIEW_KINDS, REVIEW_STATUS, badge, plain, titleCell, dueCell } from "./registers-shared.js";

/** The management-system registers Offset Assure adds: suppliers, training, objectives, communications, interested parties, and audits and reviews. */

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
