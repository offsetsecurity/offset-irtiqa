import type { FastifyRequest } from "fastify";
import { query, type Sql } from "../db/pool.js";

export interface AuditEntry {
  action: string;
  entity?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Append-only. Nothing in the application ever updates or deletes audit rows —
 * that is the point of it. Failures are logged but never break the request:
 * losing an audit line must not lose the user's work.
 */
export async function audit(
  request: FastifyRequest,
  entry: AuditEntry,
  tx: Sql = { query },
): Promise<void> {
  try {
    await tx.query(
      `insert into audit_log (actor_id, actor_name, ip, action, entity, entity_id, before, after, request_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        request.user?.id ?? null,
        request.user?.username ?? "system",
        request.ip ?? null,
        entry.action,
        entry.entity ?? null,
        entry.entityId ?? null,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
        request.id,
      ],
    );
  } catch (err) {
    request.log.error({ err, entry }, "failed to write audit log entry");
  }
}

/** Used by the login route, where there is no session user yet. */
export async function auditAnonymous(
  ip: string | undefined,
  action: string,
  detail: string,
): Promise<void> {
  try {
    await query(
      `insert into audit_log (actor_name, ip, action, entity_id) values ($1, $2, $3, $4)`,
      ["anonymous", ip ?? null, action, detail],
    );
  } catch {
    // best effort
  }
}
