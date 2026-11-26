import type { VNode } from "preact";
import { html } from "./html.js";
import type { ColumnSpec } from "./Register.js";
import { type RegisterRow } from "../persistence/apiClient.js";
import { localDay } from "./format.js";

/** The choices (statuses, kinds, types) and the small cell helpers every register uses. */

export const ASSET_TYPES = [
  "Cloud Provider", "SaaS", "Software", "Hardware", "Service",
  "Data / Information", "Information Asset", "Business Process", "People", "Facility",
] as const;
export const CRITICALITY = ["High", "Medium", "Low"] as const;
export const CLASSIFICATION = ["Public", "Internal", "Confidential", "Restricted"] as const;
export const POLICY_STATUS = ["Draft", "In Review", "Approved"] as const;
export const TASK_PRIORITY = ["Low", "Medium", "High"] as const;
export const TASK_STATUS = ["Open", "In Progress", "Done"] as const;
/** A planned change to the way you work is tracked as work, not as a second list. */
export const TASK_KINDS = ["Task", "Change"] as const;
export const SEVERITY = ["Low", "Medium", "High", "Critical"] as const;
export const INCIDENT_STATUS = ["Open", "Investigating", "Contained", "Resolved", "Closed"] as const;
export const FINDING_STATUS = ["Open", "In Progress", "Closed"] as const;
export const VENDOR_STATUS = ["Prospective", "Active", "Under review", "Exited"] as const;
export const TRAINING_RESULT = ["Completed", "In progress", "Not started", "Failed"] as const;
export const OBJECTIVE_STATUS = ["Planned", "On track", "At risk", "Met", "Missed"] as const;
export const PARTY_KINDS = [
  "Customer", "Regulator", "Staff", "Supplier", "Owner or investor", "Partner", "Other",
] as const;
export const REVIEW_KINDS = [
  "Internal audit", "Management review", "External audit", "Supplier audit",
] as const;
export const REVIEW_STATUS = ["Planned", "In progress", "Completed", "Cancelled"] as const;

export const FINDING_TYPES = [
  "Observation", "Opportunity for improvement", "Minor nonconformity", "Major nonconformity",
] as const;

export const TONE: Record<string, string> = {
  High: "#D2333D", Critical: "#D2333D", Medium: "#C47A06", Low: "#14915A",
  Restricted: "#D2333D", Confidential: "#C47A06", Internal: "#566176", Public: "#14915A",
  Open: "#C47A06", "In Progress": "#2457D6", Investigating: "#2457D6", Contained: "#0891b2",
  Done: "#14915A", Closed: "#14915A", Resolved: "#14915A", Approved: "#14915A",
  Draft: "#566176", "In Review": "#2457D6",
  Active: "#14915A", Prospective: "#566176", "Under review": "#C47A06", Exited: "#566176",
  Completed: "#14915A", "Not started": "#566176", Failed: "#D2333D",
  Planned: "#566176", "On track": "#14915A", "At risk": "#C47A06", Met: "#14915A",
  Missed: "#D2333D", Cancelled: "#566176",
};

export const badge = (value: unknown): VNode => {
  const text = String(value ?? "—");
  const colour = TONE[text] ?? "#566176";
  return html`<span class="pill" style=${`background:${colour}1a;color:${colour}`}>${text}</span>`;
};

export const plain = (value: unknown): string => {
  const text = String(value ?? "").trim();
  return text === "" ? "—" : text;
};

/** Title on the first line, a quieter detail line under it. */
export const titleCell = <T extends RegisterRow>(
  title: (r: T) => unknown,
  detail: (r: T) => string,
): ColumnSpec<T> => ({
  header: "",
  cell: (r) => html`
    <div>${String(title(r) ?? "")}</div>
    <div class="muted" style="font-size:11.5px">${detail(r)}</div>`,
});

/** Overdue dates are the only thing on these screens that should shout. */
export const dueCell = <T extends RegisterRow>(key: string, doneWhen: (r: T) => boolean): ColumnSpec<T> => ({
  header: "Due",
  width: "110px",
  cell: (r) => {
    const value = r[key] as string | null;
    if (!value) return html`<span class="muted">—</span>`;
    const overdue = !doneWhen(r) && value < localDay();
    return overdue
      ? html`<span style="color:var(--red);font-weight:700">${value}</span>`
      : html`<span class="muted">${value}</span>`;
  },
});

