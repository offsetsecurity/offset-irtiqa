import { z } from "zod";
import { registerRoutes } from "./register.js";

/**
 * The management-system registers.
 *
 * ISO 27001 asks for records the five Phase 3 registers have nowhere to put:
 * who your interested parties are and what they need, the objectives you set
 * yourself, who you trained and when, which suppliers you rely on and what
 * assurance they gave you, and the internal audits and management reviews you
 * held. Each one is a configuration of the same CRUD routes as the rest.
 *
 * The tables exist in every product. Only a pack that asks for the feature
 * shows the screens, because a NIST CSF customer being offered a management
 * review register would be a puzzle rather than a gift.
 */

const text = (max: number) => z.string().max(max).default("");
const date = () => z.string().date().nullish();
const ids = () => z.array(z.string().uuid()).default([]);
/** Where reminders go when the record's date comes. Empty means nobody is chased. */
const email = () => z.union([z.literal(""), z.string().email("That is not an email address.")]).default("");

const controlLink = (self: string, table: string) => ({
  table, self, other: "control_id", input: "controlIds", output: "control_ids",
});
const riskLink = (self: string, table: string) => ({
  table, self, other: "risk_id", input: "riskIds", output: "risk_ids",
});

// ── vendors ──────────────────────────────────────────────────────────────────
export const vendorRoutes = registerRoutes({
  table: "vendors",
  label: "Vendor",
  path: "vendors",
  // The ones that matter most, then whatever is due for review soonest.
  orderBy: "t.criticality = 'High' desc, t.review_date is null, t.review_date, t.name",
  shape: {
    name: z.string().min(1).max(300),
    service: text(300),
    criticality: z.enum(["High", "Medium", "Low"]).default("Medium"),
    classification: z
      .enum(["Public", "Internal", "Confidential", "Restricted"])
      .default("Internal"),
    status: z.enum(["Prospective", "Active", "Under review", "Exited"]).default("Prospective"),
    owner: text(200),
    ownerEmail: email(),
    assurance: text(500),
    assessedDate: date(),
    reviewDate: date(),
    notes: text(10_000),
    controlIds: ids(),
    riskIds: ids(),
  },
  columns: {
    name: "name", service: "service", criticality: "criticality",
    classification: "classification", status: "status", owner: "owner",
    ownerEmail: "owner_email", assurance: "assurance", assessedDate: "assessed_date", reviewDate: "review_date",
    notes: "notes",
  },
  links: [controlLink("vendor_id", "vendor_controls"), riskLink("vendor_id", "vendor_risks")],
});

// ── training ─────────────────────────────────────────────────────────────────
export const trainingRoutes = registerRoutes({
  table: "training",
  label: "Training record",
  key: "training",
  path: "training",
  orderBy: "t.next_due is null, t.next_due, t.person",
  shape: {
    person: z.string().min(1).max(200),
    ownerEmail: email(),
    course: text(300),
    audience: text(200),
    completedDate: date(),
    nextDue: date(),
    result: z.enum(["Completed", "In progress", "Not started", "Failed"]).default("Completed"),
    notes: text(10_000),
    controlIds: ids(),
  },
  columns: {
    person: "person", ownerEmail: "owner_email", course: "course", audience: "audience",
    completedDate: "completed_date", nextDue: "next_due", result: "result", notes: "notes",
  },
  links: [controlLink("training_id", "training_controls")],
});

// ── objectives ───────────────────────────────────────────────────────────────
export const objectiveRoutes = registerRoutes({
  table: "objectives",
  label: "Objective",
  path: "objectives",
  orderBy: "t.status in ('Met','Missed'), t.due_date is null, t.due_date, t.seq",
  shape: {
    title: z.string().min(1).max(300),
    measure: text(300),
    target: text(200),
    owner: text(200),
    ownerEmail: email(),
    dueDate: date(),
    status: z.enum(["Planned", "On track", "At risk", "Met", "Missed"]).default("Planned"),
    notes: text(10_000),
    controlIds: ids(),
    riskIds: ids(),
  },
  columns: {
    title: "title", measure: "measure", target: "target", owner: "owner",
    ownerEmail: "owner_email", dueDate: "due_date", status: "status", notes: "notes",
  },
  links: [
    controlLink("objective_id", "objective_controls"),
    riskLink("objective_id", "objective_risks"),
  ],
});

// ── interested parties ───────────────────────────────────────────────────────
export const partyRoutes = registerRoutes({
  table: "parties",
  label: "Interested party",
  key: "party",
  path: "parties",
  orderBy: "t.seq",
  shape: {
    name: z.string().min(1).max(300),
    kind: text(80).default("Other"),
    needs: text(2000),
    addressed: text(2000),
    owner: text(200),
    ownerEmail: email(),
    reviewDate: date(),
    notes: text(10_000),
    controlIds: ids(),
  },
  columns: {
    name: "name", kind: "kind", needs: "needs", addressed: "addressed",
    owner: "owner", ownerEmail: "owner_email", reviewDate: "review_date", notes: "notes",
  },
  links: [controlLink("party_id", "party_controls")],
});

// ── audits and management reviews ────────────────────────────────────────────
export const reviewRoutes = registerRoutes({
  table: "reviews",
  label: "Audit or review",
  key: "review",
  path: "reviews",
  // Planned ones first, soonest at the top; held ones below, newest first.
  orderBy: "t.status in ('Completed','Cancelled'), t.planned_date is null, t.planned_date, t.held_date desc",
  shape: {
    title: z.string().min(1).max(300),
    kind: z
      .enum(["Internal audit", "Management review", "External audit", "Supplier audit"])
      .default("Internal audit"),
    status: z.enum(["Planned", "In progress", "Completed", "Cancelled"]).default("Planned"),
    plannedDate: date(),
    heldDate: date(),
    ledBy: text(200),
    ownerEmail: email(),
    attendees: text(1000),
    scope: text(2000),
    outcome: text(10_000),
    notes: text(10_000),
    controlIds: ids(),
  },
  columns: {
    title: "title", kind: "kind", status: "status", plannedDate: "planned_date",
    heldDate: "held_date", ledBy: "led_by", ownerEmail: "owner_email", attendees: "attendees", scope: "scope",
    outcome: "outcome", notes: "notes",
  },
  links: [controlLink("review_id", "review_controls")],
});

// ── communication arrangements (7.4) ─────────────────────────────────────────
// Who is told what about security, when, by whom and how. A plan rather than a
// log: an auditor asks what you arranged to communicate and to whom, and a
// pile of sent emails does not answer that.
export const communicationRoutes = registerRoutes({
  table: "communications",
  label: "Communication",
  key: "communication",
  path: "communications",
  // Due soonest first; undated arrangements after them.
  orderBy: "t.next_due is null, t.next_due, t.seq",
  shape: {
    topic: z.string().min(1).max(300),
    audience: text(300),
    owner: text(200),
    ownerEmail: email(),
    channel: text(200),
    frequency: text(120),
    lastSent: date(),
    nextDue: date(),
    notes: text(10_000),
    controlIds: ids(),
  },
  columns: {
    topic: "topic", audience: "audience", owner: "owner", ownerEmail: "owner_email", channel: "channel",
    frequency: "frequency", lastSent: "last_sent", nextDue: "next_due", notes: "notes",
  },
  links: [controlLink("communication_id", "communication_controls")],
});
