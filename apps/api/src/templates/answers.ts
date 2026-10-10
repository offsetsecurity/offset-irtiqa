import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { query } from "../db/pool.js";
import { packDir } from "../lib/pack.js";
import type { Answers } from "./fill.js";

/**
 * Where the answers in a filled template come from.
 *
 * fields.json, made by the build that makes the templates, lists every named
 * blank: the ones asked once (About your company, Your choices) and the ones
 * that belong to one document. The customer's answers are kept in settings
 * under 'templates'. Tables whose rows come from a register are filled from
 * that register, read fresh each time a document is downloaded, so a
 * document is never older than the screen it came from.
 *
 * An answer wins over everything. Then whatever the product already knows
 * (the scope written on the ISMS screen, say). Then the usual answer the
 * template suggests. Anything left is a yellow blank, for Word.
 */

export interface SharedField {
  name: string;
  group: string;
  label: string;
  hint?: string;
  default?: string;
  long?: boolean;
}

export interface DocField {
  label: string;
  hint: string;
  default: string;
  long: boolean;
  context: string;
}

export interface ManifestDoc {
  file: string;
  no: string;
  title: string;
  id: string;
  items: Record<string, unknown>[];
  fields: Record<string, DocField>;
  shared: string[];
  sheet?: {
    path: string;
    cells: Record<string, string>;
    rows: Record<string, number>;
    columns: Record<string, string>;
  };
}

export interface Manifest {
  version: number;
  /** The shared answers that name a document's owner and approver, when they are not recorded in Policies. */
  ownerKey?: string;
  approverKey?: string;
  groups: { id: string; title: string; note: string }[];
  shared: SharedField[];
  documents: ManifestDoc[];
}

export interface Stored {
  /** Answers by blank name. An empty string means "leave it blank on purpose". */
  values: Record<string, string>;
  /** Rows typed into the form, for tables such as the locations in scope. */
  lists: Record<string, string[][]>;
}

const templatesDir = (): string => join(packDir(), "templates");

/** fields.json, or null for a pack whose templates cannot be filled in. */
export async function loadManifest(): Promise<Manifest | null> {
  try {
    return JSON.parse(await readFile(join(templatesDir(), "fields.json"), "utf8")) as Manifest;
  } catch {
    return null;
  }
}

export async function readTemplate(file: string): Promise<Buffer> {
  return readFile(join(templatesDir(), file));
}

/** Template titles as index.json gives them, which is what "Add to my policies" names a policy. */
async function templateTitles(): Promise<Record<string, string>> {
  try {
    const index = JSON.parse(await readFile(join(templatesDir(), "index.json"), "utf8")) as {
      documents: { file: string; title: string }[];
    };
    return Object.fromEntries(index.documents.map((d) => [d.file, d.title]));
  } catch {
    return {};
  }
}

export async function loadStored(): Promise<Stored> {
  const { rows } = await query<{ value: string }>("select value from settings where key = 'templates'");
  try {
    const v = rows[0] ? (JSON.parse(rows[0].value) as Partial<Stored>) : {};
    return { values: v.values ?? {}, lists: v.lists ?? {} };
  } catch {
    return { values: {}, lists: {} };
  }
}

export async function saveStored(stored: Stored): Promise<void> {
  await query(
    `insert into settings (key, value, updated_at)
     values ('templates', $1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [JSON.stringify(stored)],
  );
}

// ── what the product already knows ───────────────────────────────────────────

/** 3 October 2026. Documents are read by people, not parsed. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** The four ways to treat a risk, in the words ISO 27001 and document 04 use. */
const OPTION: Record<string, string> = { Mitigate: "Modify", Accept: "Retain", Transfer: "Share", Avoid: "Avoid" };

const STATUS_WORDS: Record<string, string> = {
  not_started: "Not started", in_progress: "In progress", implemented: "Implemented", not_applicable: "Not applicable",
};

interface Policy {
  name: string;
  version: string;
  owner: string;
  status: string;
  approver: string;
  approval_date: string | null;
  review_date: string | null;
}

export interface Known {
  derived: Record<string, string>;
  sources: Record<string, string[][]>;
  policies: Map<string, Policy>;
  titles: Record<string, string>;
  /** Statement of Applicability rows, by control reference. */
  soa: Map<string, Record<string, string>>;
}

/** Everything the templates can take from the registers, read once per request. */
export async function loadKnown(docLocation: string): Promise<Known> {
  const derived: Record<string, string> = {};
  const sources: Record<string, string[][]> = {};

  await query("insert or ignore into programme (id) values (1)");
  const prog = (await query<{ scope: string | null; attrs: string }>("select scope, attrs from programme where id = 1")).rows[0];
  const attrs = JSON.parse(prog?.attrs ?? "{}") as Record<string, unknown>;
  if (prog?.scope?.trim()) derived["01.scope"] = prog.scope.trim();

  const context = Array.isArray(attrs["context"]) ? (attrs["context"] as Record<string, string>[]) : [];
  sources["issues"] = context.map((c) => [c["type"] ?? "", c["issue"] ?? "", c["impact"] ?? ""]);

  sources["parties"] = (await query<Record<string, string>>(
    "select name, needs, addressed from parties order by seq",
  )).rows.map((r) => [r["name"]!, r["needs"]!, r["addressed"]!]);

  sources["vendors"] = (await query<Record<string, string>>(
    "select name, service, assurance from vendors where status <> 'Exited' order by criticality = 'High' desc, name",
  )).rows.map((r) => [r["service"] || r["name"]!, r["name"]!, r["assurance"]!]);

  const titles = await templateTitles();
  const templateNames = new Set(Object.values(titles).map((t) => t.toLowerCase()));
  const policyRows = (await query<Policy & { seq: number; refs: string | null }>(
    `select p.seq, p.name, p.version, p.owner, p.status, p.approver, p.approval_date, p.review_date,
            (select group_concat(c.ref, ', ') from policy_controls pc join controls c on c.id = pc.control_id
              where pc.policy_id = p.id) as refs
       from policies p order by p.name`,
  )).rows;
  const policies = new Map(policyRows.map((p) => [p.name.trim().toLowerCase(), p]));
  sources["policies"] = policyRows
    .filter((p) => !templateNames.has(p.name.trim().toLowerCase()))
    .map((p) => [`POL-${pad(p.seq)}`, p.name, p.refs ?? "", p.owner, p.version, longDate(p.review_date), docLocation]);

  sources["training"] = (await query<Record<string, string>>(
    "select person, course, audience, completed_date, next_due, result from training order by next_due is null, next_due, person",
  )).rows.map((r) => [r["person"]!, r["course"]!, r["audience"]!, longDate(r["completed_date"]), longDate(r["next_due"]), r["result"]!]);

  sources["assets"] = (await query<Record<string, string>>(
    "select name, type, owner, classification, criticality, location from assets order by criticality = 'High' desc, name",
  )).rows.map((r) => [r["name"]!, r["type"]!, r["owner"]!, r["classification"]!, r["criticality"]!, r["location"]!]);

  sources["incidents"] = (await query<Record<string, string>>(
    "select title, detected_date, severity, status, owner from incidents order by detected_date desc, seq desc",
  )).rows.map((r) => [r["title"]!, longDate(r["detected_date"]), r["severity"]!, r["status"]!, r["owner"]!]);

  sources["communications"] = (await query<Record<string, string>>(
    "select topic, notes, audience, frequency, channel, owner from communications order by seq",
  )).rows.map((r) => [r["topic"]!, r["notes"]!, r["audience"]!, r["frequency"]!, r["channel"]!, r["owner"]!]);

  sources["audits"] = (await query<Record<string, string>>(
    `select title, scope, led_by, coalesce(planned_date, held_date) as day, status from reviews
      where kind = 'Internal audit' and status <> 'Cancelled'
      order by coalesce(planned_date, held_date), seq`,
  )).rows.map((r) => [r["title"]!, r["scope"]!, r["led_by"]!, longDate(r["day"]), r["status"]!]);

  const findings = (await query<Record<string, string> & { seq: number }>(
    "select seq, title, type, source, owner, status, created_at from findings order by seq",
  )).rows;
  const improvement = (f: Record<string, string>): boolean => /improv/i.test(f["type"] ?? "");
  sources["findings"] = findings.filter((f) => !improvement(f)).map((f) => [
    `NC-${pad(f.seq, 3)}`, longDate(f["created_at"]),
    f["source"] ? `${f["title"]} (${f["source"]})` : f["title"]!, f["owner"]!, f["status"]!,
  ]);
  sources["improvements"] = findings.filter(improvement).map((f) => [
    `IM-${pad(f.seq, 3)}`, f["title"]!, f["source"]!, f["status"]!, f["owner"]!,
  ]);

  const objectives = (await query<Record<string, string>>(
    `select o.title, o.measure, o.target, o.owner, o.due_date, o.status, o.notes,
            (select group_concat(r.title, '; ') from objective_risks x join risks r on r.id = x.risk_id
              where x.objective_id = o.id) as risks,
            (select group_concat(c.ref, ', ') from objective_controls x join controls c on c.id = x.control_id
              where x.objective_id = o.id) as controls
       from objectives o order by o.seq`,
  )).rows;
  const objRef = (i: number): string => `OBJ-${pad(i + 1)}`;
  sources["objectives"] = objectives.map((o, i) => [
    objRef(i), o["title"]!, o["risks"] || o["controls"] || "",
    [o["measure"], o["target"] ? `Target ${o["target"]}` : ""].filter(Boolean).join(". "),
    o["owner"]!, longDate(o["due_date"]),
  ]);
  sources["objective_plans"] = objectives.map((o, i) => [
    objRef(i), o["notes"]!, "", o["owner"]!, longDate(o["due_date"]), o["measure"]!,
  ]);
  sources["objective_progress"] = objectives.map((o, i) => [objRef(i), "", "", o["status"]!, ""]);

  const risks = (await query<Record<string, string> & {
    seq: number; likelihood: number; impact: number; res_likelihood: number | null; res_impact: number | null;
  }>(
    `select r.seq, r.title, r.likelihood, r.impact, r.res_likelihood, r.res_impact, r.treatment, r.status,
            r.owner, r.review_date, r.accepted_by, r.accepted_date,
            (select group_concat(c.ref, ', ') from risk_controls rc join controls c on c.id = rc.control_id
              where rc.risk_id = r.id) as refs,
            (select min(t.due_date) from tasks t where t.risk_id = r.id and t.status <> 'Done') as due
       from risks r order by r.seq`,
  )).rows;
  const riskRef = (seq: number): string => `R-${pad(seq, 3)}`;
  sources["risks"] = risks.map((r) => [
    riskRef(r.seq), r["title"]!, String(r.likelihood * r.impact), OPTION[r["treatment"]!] ?? r["treatment"]!, r["owner"]!, r["status"]!,
  ]);
  const residual = (r: (typeof risks)[number]): number =>
    (r.res_likelihood ?? r.likelihood) * (r.res_impact ?? r.impact);
  sources["risk_plan"] = risks
    .filter((r) => r["status"] !== "Closed" && (r["treatment"] !== "Accept" || r.likelihood * r.impact >= 12))
    .map((r) => [
      riskRef(r.seq), r["title"]!, String(r.likelihood * r.impact), OPTION[r["treatment"]!] ?? r["treatment"]!,
      r["refs"] ?? "", "", r["owner"]!, longDate(r["due"] || r["review_date"]),
      r.res_likelihood && r.res_impact ? String(residual(r)) : "",
    ]);
  sources["risk_actions"] = (await query<Record<string, string> & { seq: number }>(
    `select r.seq, t.title, t.owner, t.due_date, t.status from tasks t join risks r on r.id = t.risk_id
      order by r.seq, t.due_date is null, t.due_date`,
  )).rows.map((t) => [riskRef(t.seq), t["title"]!, t["owner"]!, longDate(t["due_date"]), t["status"]!, ""]);
  sources["risk_accepted"] = risks
    .filter((r) => (r["accepted_by"] ?? "").trim())
    .map((r) => {
      const high = residual(r) >= 12;
      return [riskRef(r.seq), String(residual(r)), r["accepted_by"]!, longDate(r["accepted_date"]),
        high ? "" : "Not required", high ? "" : "-"];
    });

  // The Statement of Applicability, one row per control.
  const soa = new Map<string, Record<string, string>>();
  const evidence = new Map<string, string[]>();
  for (const e of (await query<{ control_id: string; name: string }>(
    `select ec.control_id, e.name from evidence_controls ec join evidence e on e.id = ec.evidence_id order by e.name`,
  )).rows) {
    evidence.set(e.control_id, [...(evidence.get(e.control_id) ?? []), e.name]);
  }
  const tested = new Map((await query<{ control_id: string; day: string }>(
    "select control_id, max(tested_on) as day from control_tests group by control_id",
  )).rows.map((t) => [t.control_id, t.day]));
  for (const c of (await query<Record<string, string>>(
    "select id, ref, status, owner, notes, justification from controls",
  )).rows) {
    const ev = evidence.get(c["id"]!) ?? [];
    soa.set(c["ref"]!, {
      applicable: c["status"] === "not_applicable" ? "No" : "Yes",
      reason: c["justification"]!,
      status: STATUS_WORDS[c["status"]!] ?? "",
      how: c["notes"]!,
      evidence: ev.length > 4 ? `${ev.slice(0, 4).join("; ")} and ${ev.length - 4} more` : ev.join("; "),
      owner: c["owner"]!,
      reviewed: longDate(tested.get(c["id"]!)),
    });
  }

  return { derived, sources, policies, titles, soa };
}

/** The answers for one document, in the shape the filler asks for them. */
export function answersFor(doc: ManifestDoc, manifest: Manifest, stored: Stored, known: Known): Answers {
  const defaults: Record<string, string> = {};
  for (const s of manifest.shared) if (s.default) defaults[s.name] = s.default;
  for (const d of manifest.documents) for (const [k, f] of Object.entries(d.fields)) if (f.default) defaults[k] = f.default;

  const lookup = (key: string, depth = 0): string | undefined => {
    if (key in stored.values) return stored.values[key] || undefined;
    if (known.derived[key]) return known.derived[key];
    const d = defaults[key];
    if (d?.startsWith("@") && depth < 3) return lookup(d.slice(1), depth + 1);
    return d || undefined;
  };

  const policyOf = (file: string): Policy | undefined => {
    const title = known.titles[file];
    return title ? known.policies.get(title.trim().toLowerCase()) : undefined;
  };
  const fileOf = (no: string): string => manifest.documents.find((d) => d.no === no)?.file ?? "";
  const mine = policyOf(doc.file);

  const value = (key: string): string | undefined => {
    switch (key) {
      case "$version": return mine?.version || "1.0";
      case "$owner": return mine?.owner || lookup(manifest.ownerKey ?? "isms_manager");
      case "$approver": return mine?.approver || lookup(manifest.approverKey ?? "doc_approver");
      case "$approval_date": return longDate(mine?.approval_date) || undefined;
      case "$next_review": return longDate(mine?.review_date) || undefined;
      case "$classification": return lookup("doc_classification");
    }
    const pol = /^pol:(\d\d):(\w+)$/.exec(key);
    if (pol) {
      const p = policyOf(fileOf(pol[1]!));
      switch (pol[2]) {
        case "owner": return p?.owner || lookup(manifest.ownerKey ?? "isms_manager");
        case "version": return p?.version || "1.0";
        case "status": return p?.status || "Draft";
        case "review": return longDate(p?.review_date) || undefined;
      }
      return undefined;
    }
    return lookup(key);
  };

  const rows = (table: string): string[][] | undefined => {
    const [kind, name] = table.split(":") as [string, string];
    const r = kind === "list" ? stored.lists[name] : known.sources[name];
    return r && r.length ? r : undefined;
  };

  return { value, rows };
}
