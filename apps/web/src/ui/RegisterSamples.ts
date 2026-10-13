import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { html } from "./html.js";
import type { RegisterSpec } from "./Register.js";
import type { RegisterRow } from "../persistence/apiClient.js";

/**
 * Starting points for the smaller registers: suppliers, interested parties,
 * objectives and training.
 *
 * The same idea as the asset and risk library (SampleLibrary.ts), but these
 * lists hold nothing framework-specific, so they live here rather than in each
 * pack. Adding copies a row into the real register and nothing more: no link
 * back, nothing to un-pick. Names are typical, not real companies; the
 * customer renames them to their own suppliers.
 */

type Sample = Record<string, unknown>;

interface Group {
  id: string;
  name: string;
  items: Sample[];
}

interface Library {
  note: string;
  /** The field that names a sample, in the camelCase the API takes. */
  nameKey: string;
  /** The same field as the list sends it back, snake_case. */
  rowKey: string;
  detail: (s: Sample) => string;
  groups: Group[];
}

const supplier = (name: string, service: string, criticality: string, classification: string, assurance: string): Sample =>
  ({ name, service, criticality, classification, assurance, status: "Active" });

const party = (name: string, kind: string, needs: string, addressed: string): Sample =>
  ({ name, kind, needs, addressed });

const objective = (title: string, measure: string, target: string): Sample =>
  ({ title, measure, target, status: "Planned" });

const course = (person: string, title: string, audience: string, notes: string): Sample =>
  ({ person, course: title, audience, notes, result: "Not started" });

export const REGISTER_SAMPLES: Record<string, Library> = {
  vendors: {
    note:
      "Typical suppliers most organisations rely on. Add the ones you use, then rename them " +
      "to the real company and fill in the assurance they gave you.",
    nameKey: "name",
    rowKey: "name",
    detail: (s) => `${s["service"]} · ${s["criticality"]} criticality · ${s["classification"]} data`,
    groups: [
      {
        id: "it", name: "IT and cloud",
        items: [
          supplier("Cloud hosting provider", "Hosts production systems and data", "High", "Confidential", "ISO 27001 certificate, SOC 2 Type II report"),
          supplier("Email and office suite", "Email, documents, calendars and file sharing", "High", "Confidential", "ISO 27001 certificate, SOC 2 Type II report"),
          supplier("Managed IT service provider", "Looks after laptops, servers and the network", "High", "Confidential", "Security questionnaire, contract with security clauses"),
          supplier("Backup service", "Off-site backups of systems and data", "High", "Confidential", "ISO 27001 certificate, restore test results"),
          supplier("Identity and sign-in provider", "Single sign-on and multi-factor authentication", "High", "Internal", "SOC 2 Type II report"),
          supplier("Internet and telecoms provider", "Office internet and phone lines", "Medium", "Internal", "Service level agreement"),
          supplier("Software development contractor", "Builds and maintains in-house software", "Medium", "Confidential", "NDA, secure development clauses in contract"),
        ],
      },
      {
        id: "business", name: "Business services",
        items: [
          supplier("Payroll provider", "Runs payroll and holds staff bank details", "High", "Restricted", "ISO 27001 certificate, data processing agreement"),
          supplier("Accounting software", "Finance records and invoicing", "Medium", "Confidential", "SOC 2 Type II report"),
          supplier("CRM provider", "Customer records and sales pipeline", "Medium", "Confidential", "ISO 27001 certificate, data processing agreement"),
          supplier("Recruitment agency", "Finds candidates and holds their CVs", "Low", "Confidential", "Data processing agreement"),
          supplier("Payment processor", "Takes card payments from customers", "High", "Restricted", "PCI DSS attestation of compliance"),
        ],
      },
      {
        id: "facilities", name: "Facilities",
        items: [
          supplier("Office landlord", "Building access and physical security", "Medium", "Internal", "Lease terms, access control arrangements"),
          supplier("Cleaning company", "Cleans the office out of hours", "Low", "Internal", "Background checks, confidentiality agreement"),
          supplier("Confidential waste and shredding", "Collects and destroys paper and media", "Medium", "Confidential", "Certificates of destruction"),
          supplier("CCTV and alarm provider", "Monitors the office", "Low", "Internal", "Service contract"),
        ],
      },
    ],
  },

  parties: {
    note:
      "The people and groups who usually have an interest in your information security. " +
      "Add the ones that apply, then write what they need in your own words.",
    nameKey: "name",
    rowKey: "name",
    detail: (s) => `${s["kind"]} · ${s["needs"]}`,
    groups: [
      {
        id: "external", name: "Outside the organisation",
        items: [
          party("Customers", "Customer", "Their data is kept confidential and the service stays available.", "Security controls, contracts, incident notification, certification."),
          party("Regulators", "Regulator", "Compliance with data protection and sector rules.", "Legal register, privacy notices, breach reporting procedure."),
          party("Data protection authority", "Regulator", "Personal data handled lawfully; breaches reported in time.", "Privacy programme, records of processing, breach procedure."),
          party("Suppliers", "Supplier", "Clear security requirements and safe access to our systems.", "Supplier policy, contracts, access control."),
          party("Certification body", "Other", "Evidence that the management system works as described.", "Internal audits, management reviews, records."),
          party("Insurers", "Partner", "Reasonable security to keep cover in place.", "Controls such as MFA, backups and incident response."),
          party("Business partners", "Partner", "Shared information is protected.", "NDAs, agreed sharing methods."),
        ],
      },
      {
        id: "internal", name: "Inside the organisation",
        items: [
          party("Board and senior management", "Owner or investor", "Risks understood and managed; the business protected.", "Management reviews, risk reports, objectives."),
          party("Owners and investors", "Owner or investor", "The value of the business protected.", "Risk management, reporting."),
          party("Employees", "Staff", "Clear rules, training, and their own personal data protected.", "Policies, awareness training, HR privacy notice."),
          party("Contractors and temporary staff", "Staff", "Know the rules and get the access they need, no more.", "Onboarding, acceptable use policy, access reviews."),
          party("IT team", "Staff", "Tools, time and authority to run security controls.", "Budget, roles and responsibilities."),
        ],
      },
    ],
  },

  objectives: {
    note:
      "Measurable security objectives many organisations set. Add the ones that fit, then set " +
      "your own targets and dates.",
    nameKey: "title",
    rowKey: "title",
    detail: (s) => `${s["measure"]} · target ${s["target"]}`,
    groups: [
      {
        id: "people", name: "People",
        items: [
          objective("All staff complete security awareness training", "Staff who completed training this year", "100%"),
          objective("Fewer people click on phishing tests", "Click rate in phishing simulations", "Under 5%"),
          objective("New starters trained in their first week", "New starters trained within 5 working days", "100%"),
        ],
      },
      {
        id: "technology", name: "Technology",
        items: [
          objective("Critical patches applied quickly", "Critical patches applied within 14 days", "95%"),
          objective("Multi-factor authentication everywhere", "Accounts with MFA turned on", "100%"),
          objective("Backups that can be restored", "Successful restore tests per quarter", "At least 1"),
          objective("Access reviewed regularly", "Systems with a completed access review this quarter", "100%"),
          objective("No high-risk vulnerabilities left open", "High findings older than 30 days", "0"),
        ],
      },
      {
        id: "management", name: "Management system",
        items: [
          objective("Incidents handled on time", "Incidents closed within the agreed time", "90%"),
          objective("Audit findings closed on time", "Findings closed by their due date", "90%"),
          objective("Risks reviewed on schedule", "Risks reviewed in the last 12 months", "100%"),
          objective("Key suppliers assessed", "Critical suppliers assessed in the last year", "100%"),
          objective("Policies reviewed every year", "Policies reviewed in the last 12 months", "100%"),
        ],
      },
    ],
  },

  training: {
    note:
      "Common security training. Each is added as a record for a group; change the group to a " +
      "person's name if you track people one by one.",
    nameKey: "course",
    rowKey: "course",
    detail: (s) => `${s["audience"]} · ${s["notes"]}`,
    groups: [
      {
        id: "everyone", name: "Everyone",
        items: [
          course("All staff", "Annual security awareness", "Everyone", "Passwords, phishing, safe use of email and devices."),
          course("All staff", "Phishing awareness and simulation", "Everyone", "Spotting and reporting suspicious messages."),
          course("All staff", "Data protection and privacy", "Everyone", "Handling personal data and reporting a breach."),
          course("All staff", "Acceptable use policy", "Everyone", "Read and accept the rules for company systems."),
          course("New starters", "Security induction", "New starters", "Policies, reporting incidents, clear desk, remote working."),
        ],
      },
      {
        id: "roles", name: "Specific roles",
        items: [
          course("Developers", "Secure coding", "Developers", "Common vulnerabilities and how to avoid them."),
          course("IT administrators", "Privileged access and secure administration", "IT team", "Safe use of admin accounts and logging."),
          course("Incident response team", "Incident response exercise", "Incident team", "A walk-through of a realistic incident."),
          course("Managers", "Security responsibilities for managers", "Managers", "Joiners, movers, leavers and approving access."),
          course("Internal auditors", "Internal auditor training", "Auditors", "Planning, running and reporting an internal audit."),
        ],
      },
    ],
  },
};

export function RegisterSamples({
  kind,
  spec,
  canEdit,
  onAdded,
}: {
  kind: string;
  spec: RegisterSpec<RegisterRow>;
  canEdit: boolean;
  onAdded: () => void;
}): VNode {
  const lib = REGISTER_SAMPLES[kind]!;
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(lib.groups[0]!.id);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();

  async function loadExisting(): Promise<void> {
    const rows = await spec.api.list();
    setTaken(new Set(rows.map((r) => norm(r[lib.rowKey]))));
  }

  useEffect(() => {
    setOpen(lib.groups[0]!.id);
    loadExisting().catch((err: Error) => setError(err.message));
  }, [kind]);

  async function addOne(item: Sample): Promise<void> {
    await spec.api.create({ ...spec.blank(), ...item });
  }

  async function run(key: string, work: () => Promise<void>): Promise<void> {
    setBusy(key);
    setError("");
    try {
      await work();
      await loadExisting();
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  const group = lib.groups.find((g) => g.id === open) ?? lib.groups[0]!;
  const label = (s: Sample): string => String(s[lib.nameKey]);
  const isTaken = (s: Sample): boolean => taken.has(norm(s[lib.nameKey]));
  const remaining = (g: Group): number => g.items.filter((i) => !isTaken(i)).length;

  return html`
    <div class="card pad">
      <p class="sl-note">${lib.note}</p>
      ${error ? html`<div class="err">${error}</div>` : null}

      <div class="sl-groups">
        ${lib.groups.map(
          (g) => html`<button type="button" key=${g.id}
            class=${`sl-group${g.id === group.id ? " sel" : ""}`}
            onClick=${() => setOpen(g.id)}>
            ${g.name}
            <span class="sl-count">${remaining(g)} of ${g.items.length}</span>
          </button>`,
        )}
      </div>

      <div class="sl-head">
        <h2>${group.name}</h2>
        ${canEdit && remaining(group) > 0
          ? html`<button type="button" class="btn small" disabled=${Boolean(busy)}
                   onClick=${() => void run("*", async () => {
                     for (const item of group.items) if (!isTaken(item)) await addOne(item);
                   })}>
              Add all ${remaining(group)}
            </button>`
          : null}
      </div>

      <div class="sl-list">
        ${group.items.map((item) => {
          const name = label(item);
          const already = isTaken(item);
          return html`<div class=${`sl-row${already ? " taken" : ""}`} key=${name}>
            <div class="sl-main">
              <div class="sl-name">${name}</div>
              <div class="sl-meta muted">${lib.detail(item)}</div>
            </div>
            ${already
              ? html`<span class="sl-in">In your register</span>`
              : canEdit
                ? html`<button type="button" class="btn small primary" disabled=${Boolean(busy)}
                         onClick=${() => void run(name, () => addOne(item))}>
                    ${busy === name ? "Adding…" : "Add"}
                  </button>`
                : null}
          </div>`;
        })}
      </div>
    </div>`;
}
