import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { HttpError } from "../lib/errors.js";

/**
 * The audit trail, read only: who did what, when, from where, and what it
 * changed.
 *
 * Administrators and auditors, nobody else. The help pages have always said
 * the Auditor role reads it; until this screen it could not, and a record that
 * nobody can see is a record nobody reviews. Contributors are left out on
 * purpose: the trail holds failed sign-ins and addresses, which are security
 * information rather than compliance data.
 *
 * There is no route that changes or deletes an entry, here or anywhere else.
 */

const canReadAudit = Object.assign(async (request: FastifyRequest): Promise<void> => {
  requireAuth(request);
  if (request.user.role !== "admin" && request.user.role !== "auditor") {
    throw new HttpError(403, "Only administrators and auditors can read the audit trail.");
  }
}, { allowed: ["admin", "auditor"] as const });

/** Query strings arrive as "" for an empty box; that means no filter. */
const opt = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const filterShape = {
  q: opt(z.string().trim().max(200)),
  person: opt(z.string().trim().max(200)),
  action: opt(z.string().trim().max(200)),
  entity: opt(z.string().trim().max(100)),
  // Instants, not dates: the browser turns "from 1 May" into the start of
  // 1 May where the reader is, which the server cannot know.
  from: opt(z.string().datetime({ offset: true })),
  to: opt(z.string().datetime({ offset: true })),
};
const filters = z.object(filterShape);
type Filters = z.infer<typeof filters>;

const listQuery = z.object({
  ...filterShape,
  before: opt(z.coerce.number().int().positive()),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** Most rows one download holds. Beyond this, narrow the dates. */
const EXPORT_MAX = 100_000;

interface AuditRow {
  id: number;
  ts: string;
  actor_name: string;
  ip: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  before: string | null;
  after: string | null;
}

function whereClause(f: Filters): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const p = (value: unknown): string => `$${params.push(value)}`;
  const parts: string[] = [];
  if (f.person) parts.push(`actor_name = ${p(f.person)}`);
  if (f.action) parts.push(`action = ${p(f.action)}`);
  if (f.entity) parts.push(`entity = ${p(f.entity)}`);
  if (f.from) parts.push(`ts >= ${p(new Date(f.from).toISOString())}`);
  if (f.to) parts.push(`ts < ${p(new Date(f.to).toISOString())}`);
  if (f.q) {
    // One parameter, used seven times. Wildcards typed in the box are
    // searched for, not obeyed.
    const like = p(`%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const cols = ["action", "actor_name", "entity", "entity_id", "ip", "before", "after"];
    parts.push(`(${cols.map((c) => `${c} like ${like} escape '\\'`).join(" or ")})`);
  }
  return { sql: parts.length ? `where ${parts.join(" and ")}` : "", params };
}

/**
 * Fields that must never be shown, whatever wrote them. Nothing the product
 * records today holds one - user entries carry the name and role, email
 * entries leave the password out - and this is here so a careless entry
 * written tomorrow still cannot put a secret on screen.
 */
const SECRET_ENDINGS = [
  "password", "passphrase", "pass", "secret", "token", "hash", "salt",
  "privatekey", "apikey", "credential", "credentials",
];
const isSecretKey = (key: string): boolean => {
  const k = key.toLowerCase().replace(/[^a-z]/g, "");
  return SECRET_ENDINGS.some((end) => k.endsWith(end));
};

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "…";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        isSecretKey(k) ? "[hidden]" : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

function parse(json: string | null): unknown {
  if (json === null) return null;
  try {
    return redact(JSON.parse(json));
  } catch {
    return json;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Bookkeeping that changes on every save and says nothing about what changed. */
const NOT_A_CHANGE = new Set(["updated_at", "updatedAt", "created_at", "createdAt"]);

export interface Change {
  field: string;
  from: unknown;
  to: unknown;
}

/** What an update actually changed: the fields whose values differ. */
function changesOf(before: unknown, after: unknown): Change[] {
  if (!isRecord(before) || !isRecord(after)) return [];
  const out: Change[] = [];
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (NOT_A_CHANGE.has(field)) continue;
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      out.push({ field, from: before[field] ?? null, to: after[field] ?? null });
    }
  }
  return out;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A name a person would recognise for the record: its reference and title. */
function labelOf(record: unknown): string | null {
  if (!isRecord(record)) return null;
  const ref = text(record["ref"]) ?? (typeof record["seq"] === "number" ? `#${record["seq"]}` : null);
  const name =
    text(record["title"]) ?? text(record["name"]) ?? text(record["username"]) ??
    text(record["filename"]) ?? text(record["file_name"]) ?? text(record["logo"]);
  return [ref, name].filter(Boolean).join(" ") || null;
}

function present(row: AuditRow) {
  const before = parse(row.before);
  const after = parse(row.after);
  return {
    id: row.id,
    ts: row.ts,
    person: row.actor_name,
    ip: row.ip,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    label: labelOf(after) ?? labelOf(before),
    changes: changesOf(before, after),
    before,
    after,
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────
const short = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 200 ? `${s.slice(0, 199)}…` : s;
};

/**
 * Excel's dialect, with one addition: a cell that starts like a formula is
 * made plain text. Anyone who can type a title can put "=HYPERLINK(...)" into
 * the trail, and an auditor opening the download should see it, not run it.
 */
function cell(value: unknown): string {
  let s = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADERS = [
  "When (UTC)", "Person", "Action", "Record type", "Record", "Address", "Changes", "Before", "After",
];

function csvLine(row: AuditRow): string {
  const e = present(row);
  const changes = e.changes.map((c) => `${c.field}: ${short(c.from)} -> ${short(c.to)}`).join("; ");
  return [
    e.ts, e.person, e.action, e.entity ?? "", e.label ?? e.entityId ?? "", e.ip ?? "", changes,
    e.before, e.after,
  ].map(cell).join(",");
}

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/audit", { preHandler: canReadAudit }, async (request) => {
    const q = listQuery.parse(request.query);
    const { sql, params } = whereClause(q);
    const cursor = q.before ? `${sql ? `${sql} and` : "where"} id < $${params.length + 1}` : sql;
    const { rows } = await query<AuditRow>(
      `select id, ts, actor_name, ip, action, entity, entity_id, before, after
         from audit_log ${cursor}
        order by id desc
        limit $${params.length + (q.before ? 2 : 1)}`,
      [...params, ...(q.before ? [q.before] : []), q.limit + 1],
    );
    const more = rows.length > q.limit;
    const page = more ? rows.slice(0, q.limit) : rows;

    // Counted once, on the first page, for "1,204 entries".
    let total: number | undefined;
    if (!q.before) {
      const counted = await query<{ n: number }>(`select count(*) as n from audit_log ${sql}`, params);
      total = Number(counted.rows[0]?.n ?? 0);
    }
    return {
      entries: page.map(present),
      next: more ? page[page.length - 1]!.id : null,
      ...(total === undefined ? {} : { total }),
    };
  });

  /** The choices for the filter lists: every person and action that appears. */
  app.get("/api/v1/audit/filters", { preHandler: canReadAudit }, async () => {
    const [people, actions, entities, oldest] = await Promise.all([
      query<{ v: string }>("select distinct actor_name as v from audit_log order by actor_name collate nocase"),
      query<{ v: string }>("select distinct action as v from audit_log order by action collate nocase"),
      query<{ v: string }>("select distinct entity as v from audit_log where entity is not null order by entity"),
      query<{ ts: string | null }>("select min(ts) as ts from audit_log"),
    ]);
    return {
      people: people.rows.map((r) => r.v),
      actions: actions.rows.map((r) => r.v),
      entities: entities.rows.map((r) => r.v),
      oldest: oldest.rows[0]?.ts ?? null,
      retentionDays: config.AUDIT_RETENTION_DAYS,
    };
  });

  app.get("/api/v1/audit/export", { preHandler: canReadAudit }, async (request, reply) => {
    const f = filters.parse(request.query);
    const { sql, params } = whereClause(f);
    const { rows } = await query<AuditRow>(
      `select id, ts, actor_name, ip, action, entity, entity_id, before, after
         from audit_log ${sql}
        order by id desc
        limit $${params.length + 1}`,
      [...params, EXPORT_MAX],
    );
    // Taking a copy of the trail is itself something the trail should show.
    await audit(request, {
      action: "Audit trail downloaded",
      entity: "audit",
      after: { rows: rows.length, filters: f },
    });
    const body = `﻿${[CSV_HEADERS.map(cell).join(","), ...rows.map(csvLine)].join("\r\n")}\r\n`;
    const day = new Date().toISOString().slice(0, 10);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="audit-trail-${day}.csv"`)
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "no-store")
      .send(body);
  });
}
