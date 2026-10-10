import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db/pool.js";
import { isAdmin, requireAuth } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { badRequest } from "../lib/errors.js";
import { hasFeature, readPack } from "../lib/pack.js";

/**
 * Example data: a small, coherent organisation, and a way to remove it again.
 *
 * Empty registers make a product impossible to judge. Somebody evaluating this
 * wants to see what a filled-in programme looks like before deciding whether to
 * spend a week filling one in, and a sales demonstration should not begin with
 * twenty minutes of typing.
 *
 * Every row it writes is marked `"demo": true` in its attrs, and removing the
 * examples deletes exactly those rows. Nothing else is touched, so an install
 * that has real work in it does not lose any of it - which is the only way this
 * is safe to offer on a live install at all.
 */

const MARK = JSON.stringify({ demo: true });

/**
 * The example is written against ISO/IEC 27001 Annex A. A product built on
 * another framework ships example-links.json in its pack, naming its own
 * control for each Annex A one the example uses, so the same small company
 * joins up in every product. Without the file the refs are used as they are.
 */
async function exampleLinks(): Promise<((iso: string) => string[]) | null> {
  try {
    const links = await readPack<Record<string, string[]>>("example-links.json");
    return (iso) => links[iso] ?? [];
  } catch {
    return null;
  }
}

/** The tables it writes to, in the order they must be emptied. */
const TABLES = [
  "evidence", "findings", "incidents", "tasks", "reviews", "parties",
  "objectives", "training", "vendors", "policies", "risks", "assets",
];

interface Row {
  table: string;
  columns: Record<string, unknown>;
  /** Control refs this row should be linked to, through `<table>_controls`. */
  controls?: string[];
}

const today = (offsetDays = 0): string =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

/**
 * One small organisation: a software company with a customer portal, a payroll
 * bureau and an office. Everything joins up - the risks point at the controls,
 * the evidence proves them, the finding has a corrective action - because a
 * demonstration of disconnected rows teaches the wrong lesson about the
 * product.
 */
const EXAMPLE: Row[] = [
  { table: "assets", columns: { name: "Customer portal", type: "Software", category: "Primary asset", criticality: "High", classification: "Confidential", owner: "Head of Engineering", location: "AWS eu-west-1" }, controls: ["A.5.9"] },
  { table: "assets", columns: { name: "Customer database", type: "Data / Information", category: "Primary asset", criticality: "High", classification: "Confidential", owner: "Head of Engineering", location: "AWS eu-west-1" }, controls: ["A.5.9", "A.8.24"] },
  { table: "assets", columns: { name: "Microsoft 365 tenant", type: "SaaS", criticality: "High", classification: "Confidential", owner: "IT Manager", location: "Microsoft, EU" }, controls: ["A.5.23"] },
  { table: "assets", columns: { name: "Employee laptops", type: "Hardware", criticality: "Medium", classification: "Internal", owner: "IT Manager", location: "With staff" }, controls: ["A.8.1"] },
  { table: "assets", columns: { name: "Head office", type: "Facility", criticality: "Medium", classification: "Internal", owner: "Office Manager", location: "Floor 3, Riyadh" }, controls: ["A.7.1"] },
  { table: "assets", columns: { name: "Source code repository", type: "Software", criticality: "High", classification: "Confidential", owner: "Head of Engineering", location: "GitHub" }, controls: ["A.8.4"] },
  { table: "assets", columns: { name: "Payroll records", type: "Data / Information", category: "Primary asset", criticality: "High", classification: "Restricted", owner: "Head of HR", location: "Payroll bureau" }, controls: ["A.5.34"] },
  { table: "assets", columns: { name: "Staff and their knowledge", type: "People", criticality: "High", classification: "Internal", owner: "Managing Director", location: "Everywhere" }, controls: ["A.6.3"] },

  { table: "risks", columns: { title: "Customer data exposed by a misconfigured cloud service", description: "A storage bucket or database is left reachable from the internet and customer records are downloaded by somebody outside the company.", category: "Security", likelihood: 3, impact: 5, res_likelihood: 2, res_impact: 5, treatment: "Mitigate", status: "Open", owner: "Head of Engineering", review_date: today(90) }, controls: ["A.5.23", "A.8.9", "A.8.3"] },
  { table: "risks", columns: { title: "Staff credentials taken by phishing", description: "An employee signs in to a convincing fake page and an attacker gets a working session.", category: "Security", likelihood: 4, impact: 4, res_likelihood: 2, res_impact: 4, treatment: "Mitigate", status: "Open", owner: "IT Manager", review_date: today(90) }, controls: ["A.6.3", "A.8.5"] },
  { table: "risks", columns: { title: "Payroll bureau suffers a breach", description: "The supplier that processes payroll is compromised and employee data is exposed, without our network being touched.", category: "Security", likelihood: 2, impact: 4, treatment: "Mitigate", status: "Open", owner: "Head of HR", review_date: today(120) }, controls: ["A.5.19", "A.5.22"] },
  { table: "risks", columns: { title: "Ransomware stops the portal", description: "Servers are encrypted and the service is unavailable while systems are rebuilt from backups.", category: "Operational", likelihood: 2, impact: 5, treatment: "Mitigate", status: "Open", owner: "Head of Engineering", review_date: today(60) }, controls: ["A.8.7", "A.8.13", "A.5.29"] },
  { table: "risks", columns: { title: "Leaver keeps access after their last day", description: "Accounts are not removed promptly, so a former employee can still sign in.", category: "Security", likelihood: 3, impact: 3, treatment: "Mitigate", status: "Open", owner: "Head of HR", review_date: today(45) }, controls: ["A.5.18", "A.6.5"] },
  { table: "risks", columns: { title: "Office break-in", description: "Somebody reaches equipment or papers in the office outside working hours.", category: "Physical", likelihood: 1, impact: 3, treatment: "Accept", status: "Open", owner: "Office Manager", review_date: today(180) }, controls: ["A.7.1", "A.7.2"] },

  { table: "policies", columns: { name: "Information security policy", version: "1.2", status: "Approved", owner: "Managing Director", approver: "Board", approval_date: today(-40), review_date: today(325) }, controls: ["A.5.1"] },
  { table: "policies", columns: { name: "Acceptable use policy", version: "1.0", status: "Approved", owner: "IT Manager", approver: "Managing Director", approval_date: today(-30), review_date: today(335) }, controls: ["A.5.10"] },
  { table: "policies", columns: { name: "Supplier management policy", version: "0.9", status: "In Review", owner: "Head of Procurement", review_date: today(20) }, controls: ["A.5.19"] },

  { table: "vendors", columns: { name: "Northwind Hosting", service: "Hosts the customer portal", criticality: "High", classification: "Confidential", status: "Active", owner: "Head of Engineering", assurance: "ISO 27001 certificate, valid to next March", assessed_date: today(-60), review_date: today(300) }, controls: ["A.5.19", "A.5.23"] },
  { table: "vendors", columns: { name: "Gulf Payroll Services", service: "Processes payroll", criticality: "High", classification: "Restricted", status: "Active", owner: "Head of HR", assurance: "Questionnaire returned; no certification", assessed_date: today(-120), review_date: today(15) }, controls: ["A.5.19", "A.5.20"] },
  { table: "vendors", columns: { name: "Bright Cleaning", service: "Office cleaning, out of hours", criticality: "Low", classification: "Internal", status: "Active", owner: "Office Manager", assurance: "Contract with confidentiality terms", review_date: today(200) }, controls: ["A.5.20", "A.7.2"] },

  { table: "training", columns: { person: "Everyone", course: "Annual security awareness", audience: "All staff", completed_date: today(-45), next_due: today(320), result: "Completed" }, controls: ["A.6.3"] },
  { table: "training", columns: { person: "Engineering team", course: "Secure development", audience: "Developers", completed_date: today(-90), next_due: today(275), result: "Completed" }, controls: ["A.8.28"] },
  { table: "training", columns: { person: "New starters, this quarter", course: "Induction: security and acceptable use", audience: "New starters", next_due: today(10), result: "In progress" }, controls: ["A.6.2"] },

  { table: "objectives", columns: { title: "Every leaver loses access within one working day", measure: "Days between last day and account disabled", target: "1 day", owner: "Head of HR", due_date: today(120), status: "On track" }, controls: ["A.5.18"] },
  { table: "objectives", columns: { title: "All staff complete awareness training each year", measure: "Percentage completed, from the training records", target: "100%", owner: "IT Manager", due_date: today(200), status: "On track" }, controls: ["A.6.3"] },
  { table: "objectives", columns: { title: "No critical vulnerability open longer than 14 days", measure: "Days open, from the scanner", target: "14 days", owner: "Head of Engineering", due_date: today(90), status: "At risk" }, controls: ["A.8.8"] },

  { table: "parties", columns: { name: "Enterprise customers", kind: "Customer", needs: "Proof of certification each year, and notice of a breach within 24 hours", addressed: "Certificate shared at renewal; breach terms in every contract", owner: "Managing Director" }, controls: ["A.5.31"] },
  { table: "parties", columns: { name: "Data protection regulator", kind: "Regulator", needs: "Lawful processing of personal data, and breach notification within 72 hours", addressed: "Privacy notice, records of processing, incident process", owner: "Head of Legal" }, controls: ["A.5.34", "A.5.31"] },
  { table: "parties", columns: { name: "Staff", kind: "Staff", needs: "Clear rules, training, and their own data handled properly", addressed: "Handbook, annual training, HR records access limited", owner: "Head of HR" }, controls: ["A.6.2", "A.6.3"] },
  { table: "parties", columns: { name: "Payroll bureau", kind: "Supplier", needs: "Accurate data on time; confidentiality obligations both ways", addressed: "Contract with security terms, reviewed yearly", owner: "Head of HR" }, controls: ["A.5.20"] },

  { table: "reviews", columns: { title: "Internal audit: organisational and people controls", kind: "Internal audit", status: "Completed", planned_date: today(-35), held_date: today(-33), led_by: "External consultant", attendees: "ISMS manager, HR, IT", scope: "Organisational and people controls", outcome: "Two minor nonconformities, both raised as findings." }, controls: ["A.5.35"] },
  { table: "reviews", columns: { title: "Management review, first half", kind: "Management review", status: "Completed", planned_date: today(-20), held_date: today(-20), led_by: "Managing Director", attendees: "Managing Director, Head of Engineering, Head of HR, ISMS manager", scope: "Objectives, risks, incidents, audit results", outcome: "Agreed to fund a second awareness campaign and to review the payroll bureau early." } },
  { table: "reviews", columns: { title: "Internal audit: technological controls", kind: "Internal audit", status: "Planned", planned_date: today(55), led_by: "External consultant", scope: "Technological controls" } },

  { table: "findings", columns: { title: "Leavers not removed from the payroll system", type: "Minor nonconformity", status: "Closed", source: "Internal audit", description: "Two of five leavers sampled still had payroll access a week after leaving.", clause: "A.5.18", owner: "Head of HR", due_date: today(-5), root_cause: "The monthly check had no named owner, so it was never run.", action_taken: "The check is now a recurring task with an owner and a date.", verification: "Three leavers re-tested in the following month; all removed within a day.", verified_by: "Internal audit", verified_date: today(-3) }, controls: ["A.5.18", "A.6.5"] },
  { table: "findings", columns: { title: "Supplier assurance missing for the payroll bureau", type: "Minor nonconformity", status: "In Progress", source: "Internal audit", description: "No independent assurance held for a supplier processing restricted data.", clause: "A.5.19", owner: "Head of Procurement", due_date: today(25), root_cause: "Supplier reviews were informal and undocumented." }, controls: ["A.5.19", "A.5.22"] },
  { table: "findings", columns: { title: "Clear desk not observed on the third floor", type: "Observation", status: "Open", source: "Internal audit", description: "Printed customer records left out overnight on two desks.", clause: "A.7.7", owner: "Office Manager", due_date: today(40) }, controls: ["A.7.7"] },

  { table: "tasks", columns: { title: "Get an assurance report from the payroll bureau", owner: "Head of Procurement", due_date: today(25), priority: "High", status: "In Progress", notes: "Ask for their latest independent report, or complete a full assessment." } },
  { table: "tasks", columns: { title: "Turn on data loss prevention rules in Microsoft 365", owner: "IT Manager", due_date: today(30), priority: "Medium", status: "Open" } },
  { table: "tasks", columns: { title: "Run the quarterly access review", owner: "IT Manager", due_date: today(12), priority: "High", status: "Open" } },
  { table: "tasks", columns: { title: "Test the restore of a backup", owner: "Head of Engineering", due_date: today(-2), priority: "High", status: "Open", notes: "Overdue on purpose in the example data: this is what an overdue row looks like." } },

  { table: "incidents", columns: { title: "Phishing email reached 40 mailboxes", detected_date: today(-25), owner: "IT Manager", severity: "Medium", status: "Closed", description: "A credential-harvesting email got past filtering. Two people clicked; neither entered a password. Rule added, staff reminded." } },
  { table: "incidents", columns: { title: "Laptop left in a taxi", detected_date: today(-70), owner: "IT Manager", severity: "Low", status: "Closed", description: "Encrypted device, remotely wiped the same afternoon. No data at risk." } },

  { table: "evidence", columns: { name: "Approved information security policy", type: "Approval", owner: "Managing Director", collected_date: today(-40), next_review: today(325) }, controls: ["A.5.1"] },
  { table: "evidence", columns: { name: "Quarterly access review, this quarter", type: "Report", owner: "IT Manager", collected_date: today(-20), next_review: today(70) }, controls: ["A.5.18", "A.8.2"] },
  { table: "evidence", columns: { name: "Awareness training completion report", type: "Report", owner: "IT Manager", collected_date: today(-45), next_review: today(320) }, controls: ["A.6.3"] },
  { table: "evidence", columns: { name: "Backup restore test record", type: "Report", owner: "Head of Engineering", collected_date: today(-120), next_review: today(-30) }, controls: ["A.8.13"] },
  { table: "evidence", columns: { name: "Northwind Hosting ISO 27001 certificate", type: "Assessment", owner: "Head of Engineering", collected_date: today(-60), next_review: today(300) }, controls: ["A.5.19"] },
];

/**
 * Controls the example has an opinion about.
 *
 * Only ones left exactly as seeded are touched, and removing the examples puts
 * back only the ones still holding exactly what was written here. Somebody who
 * edits an example control afterwards keeps their edit: the reset sees the
 * change and leaves it alone, which is the difference between a demonstration
 * and a hazard.
 */
const CONTROL_EXAMPLES: { ref: string; status: string; owner: string; justification: string }[] = [
  { ref: "A.5.1", status: "implemented", owner: "Managing Director", justification: "Required by the standard and by our customers" },
  { ref: "A.5.2", status: "implemented", owner: "Managing Director", justification: "Roles are named in the policy" },
  { ref: "A.5.9", status: "implemented", owner: "Head of Engineering", justification: "The asset inventory is the base of the risk assessment" },
  { ref: "A.5.10", status: "implemented", owner: "IT Manager", justification: "Acceptable use policy, signed at induction" },
  { ref: "A.5.12", status: "in_progress", owner: "Information Security Manager", justification: "Classification scheme agreed, labelling under way" },
  { ref: "A.5.15", status: "implemented", owner: "IT Manager", justification: "Access is granted by role and reviewed quarterly" },
  { ref: "A.5.18", status: "in_progress", owner: "Head of HR", justification: "Treats the leaver risk; the monthly check is new" },
  { ref: "A.5.19", status: "in_progress", owner: "Head of Procurement", justification: "Supplier assurance is being brought up to date" },
  { ref: "A.5.23", status: "implemented", owner: "Head of Engineering", justification: "Everything runs in the cloud" },
  { ref: "A.5.24", status: "implemented", owner: "Information Security Manager", justification: "Incident process, tested by two real incidents" },
  { ref: "A.5.29", status: "in_progress", owner: "Head of Engineering", justification: "Continuity plan written, not yet exercised" },
  { ref: "A.5.31", status: "implemented", owner: "Head of Legal", justification: "Contractual and data protection obligations" },
  { ref: "A.5.34", status: "implemented", owner: "Head of Legal", justification: "We process employee and customer personal data" },
  { ref: "A.6.1", status: "implemented", owner: "Head of HR", justification: "Screening before employment" },
  { ref: "A.6.2", status: "implemented", owner: "Head of HR", justification: "Security terms in every contract" },
  { ref: "A.6.3", status: "implemented", owner: "IT Manager", justification: "Treats the phishing risk; training runs yearly" },
  { ref: "A.6.5", status: "in_progress", owner: "Head of HR", justification: "Offboarding checklist being tightened after the audit" },
  { ref: "A.6.7", status: "implemented", owner: "IT Manager", justification: "Most staff work from home part of the week" },
  { ref: "A.7.1", status: "implemented", owner: "Office Manager", justification: "One office, with controlled entry" },
  { ref: "A.7.2", status: "implemented", owner: "Office Manager", justification: "Badge entry, visitors signed in" },
  { ref: "A.7.4", status: "not_applicable", owner: "", justification: "No premises of our own beyond one serviced office; monitoring is the landlord's" },
  { ref: "A.7.7", status: "in_progress", owner: "Office Manager", justification: "Clear desk rule published; observed unevenly" },
  { ref: "A.8.1", status: "implemented", owner: "IT Manager", justification: "Managed laptops, encrypted" },
  { ref: "A.8.2", status: "implemented", owner: "IT Manager", justification: "Admin rights are separate accounts" },
  { ref: "A.8.5", status: "implemented", owner: "IT Manager", justification: "Treats the phishing risk; MFA everywhere" },
  { ref: "A.8.7", status: "implemented", owner: "IT Manager", justification: "Endpoint protection on every device" },
  { ref: "A.8.8", status: "in_progress", owner: "Head of Engineering", justification: "Scanning in place; the 14-day target is an objective" },
  { ref: "A.8.13", status: "implemented", owner: "Head of Engineering", justification: "Treats ransomware; restores are tested" },
  { ref: "A.8.15", status: "implemented", owner: "Head of Engineering", justification: "Logging is on and retained" },
  { ref: "A.8.16", status: "in_progress", owner: "Head of Engineering", justification: "Alerts exist; nobody watches them out of hours yet" },
  { ref: "A.8.24", status: "implemented", owner: "Head of Engineering", justification: "Customer data encrypted at rest and in transit" },
  { ref: "A.8.28", status: "implemented", owner: "Head of Engineering", justification: "Secure coding training and review" },
  { ref: "A.8.31", status: "implemented", owner: "Head of Engineering", justification: "Separate development and production accounts" },
  { ref: "A.8.32", status: "in_progress", owner: "Head of Engineering", justification: "Change process written, approvals inconsistent" },
];

/** Which link table joins a register to controls. */
const LINKS: Record<string, { table: string; column: string }> = {
  assets: { table: "asset_controls", column: "asset_id" },
  risks: { table: "risk_controls", column: "risk_id" },
  policies: { table: "policy_controls", column: "policy_id" },
  evidence: { table: "evidence_controls", column: "evidence_id" },
  findings: { table: "finding_controls", column: "finding_id" },
  vendors: { table: "vendor_controls", column: "vendor_id" },
  training: { table: "training_controls", column: "training_id" },
  objectives: { table: "objective_controls", column: "objective_id" },
  parties: { table: "party_controls", column: "party_id" },
  reviews: { table: "review_controls", column: "review_id" },
};

const countExamples = async (): Promise<number> => {
  let total = 0;
  for (const table of [...TABLES, "controls"]) {
    const { rows } = await query<{ n: number }>(
      `select count(*) as n from ${table} where json_extract(attrs, '$.demo') = 1`,
    );
    total += rows[0]?.n ?? 0;
  }
  return total;
};

export async function demoRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/demo", { preHandler: isAdmin }, async () => ({
    rows: await countExamples(),
    available: EXAMPLE.length,
  }));

  app.post("/api/v1/demo", { preHandler: isAdmin }, async (request, reply) => {
    requireAuth(request);
    if (!(await hasFeature("demoData"))) throw badRequest("This product does not ship example data.");
    if ((await countExamples()) > 0) throw badRequest("The examples are already loaded. Remove them first.");

    const links = await exampleLinks();
    const refsOf = (iso: string): string[] => (links ? links(iso) : [iso]);
    const byRef = new Map<string, string>();
    for (const row of (await query<{ id: string; ref: string }>("select id, ref from controls")).rows) {
      byRef.set(row.ref, row.id);
    }

    let written = 0;
    await withTransaction(async (tx) => {
      for (const row of EXAMPLE) {
        // Anything already in the register under the same name is left alone,
        // so a risk added from the Sample library is not added a second time.
        const named = "title" in row.columns ? "title" : "name" in row.columns ? "name" : null;
        if (named) {
          const { rows: same } = await tx.query(
            `select 1 from ${row.table} where lower(trim(${named})) = lower(trim($1)) limit 1`,
            [String((row.columns as Record<string, unknown>)[named])],
          );
          if (same.length) continue;
        }
        const id = randomUUID();
        const columns: Record<string, unknown> = { ...row.columns, id, attrs: MARK };
        // A finding names the control it was raised against in this product's terms.
        if (typeof columns["clause"] === "string") columns["clause"] = refsOf(columns["clause"])[0] ?? columns["clause"];

        // Every register but evidence carries a display number, and it must
        // not collide with anything already there.
        if (row.table !== "evidence") {
          const { rows: next } = await tx.query<{ next: number }>(
            `select coalesce(max(seq), 0) + 1 as next from ${row.table}`,
          );
          Object.assign(columns, { seq: next[0]?.next ?? 1 });
        }

        const names = Object.keys(columns);
        await tx.query(
          `insert into ${row.table} (${names.join(", ")})
           values (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
          Object.values(columns),
        );
        written++;

        const link = LINKS[row.table];
        for (const ref of (row.controls ?? []).flatMap(refsOf)) {
          const controlId = byRef.get(ref);
          if (!link || !controlId) continue;
          await tx.query(
            `insert or ignore into ${link.table} (${link.column}, control_id) values ($1, $2)`,
            [id, controlId],
          );
        }
      }
    });

    // The controls: an opinion on a third of them, so the dashboard, the gap
    // list and the Statement of Applicability show something worth reading.
    // Only controls still exactly as seeded are touched.
    let controls = 0;
    // Two Annex A controls can map to one control elsewhere; the first decides.
    const seen = new Set<string>();
    const examples = CONTROL_EXAMPLES.flatMap((e) => refsOf(e.ref).slice(0, 1).map((ref) => ({ ...e, ref })))
      .filter((e) => !seen.has(e.ref) && seen.add(e.ref));
    await withTransaction(async (tx) => {
      for (const example of examples) {
        const { rowCount } = await tx.query(
          `update controls
              set status = $2, owner = $3, justification = $4,
                  attrs = json_patch(attrs, $5)
            where ref = $1
              and status = 'not_started' and trim(owner) = '' and trim(justification) = ''`,
          [
            example.ref,
            example.status,
            example.owner,
            example.justification,
            JSON.stringify({ demo: true, set: example }),
          ],
        );
        controls += rowCount;
      }
    });

    await audit(request, {
      action: "Example data loaded",
      entity: "demo",
      entityId: "example",
      after: { rows: written, controls },
    });
    reply.code(201);
    return { rows: written + controls };
  });

  app.delete("/api/v1/demo", { preHandler: isAdmin }, async (request, reply) => {
    requireAuth(request);
    let removed = 0;
    await withTransaction(async (tx) => {
      for (const table of TABLES) {
        const { rowCount } = await tx.query(
          `delete from ${table} where json_extract(attrs, '$.demo') = 1`,
        );
        removed += rowCount;
      }

      // Controls are not deleted - they are the framework - so the example's
      // opinion is taken back, and only where nobody has since changed it.
      const { rowCount: reset } = await tx.query(
        `update controls
            set status = 'not_started', owner = '', justification = '',
                attrs = json_remove(attrs, '$.demo', '$.set')
          where json_extract(attrs, '$.demo') = 1
            and status = json_extract(attrs, '$.set.status')
            and owner = json_extract(attrs, '$.set.owner')
            and justification = json_extract(attrs, '$.set.justification')`,
      );
      removed += reset;

      // Anything edited since keeps the edit, and stops being an example.
      await tx.query(
        `update controls set attrs = json_remove(attrs, '$.demo', '$.set')
          where json_extract(attrs, '$.demo') = 1`,
      );
    });

    await audit(request, { action: "Example data removed", entity: "demo", entityId: "example", before: { rows: removed } });
    reply.code(200);
    return { removed };
  });
}
