import type { FastifyReply, FastifyRequest } from "fastify";
import { conflict } from "./errors.js";

/**
 * Two people editing the same record (GL-5, go-live check 15 Nov 2026).
 *
 * The page sends the record's `updated_at` as it last saw it, in the
 * `x-record-version` header, with every change. If the record has been saved
 * by somebody else since, the change is refused with a plain message instead
 * of silently overwriting theirs. No header (an older page, a script): no
 * check, as before.
 */
export const RECORD_VERSION_HEADER = "x-record-version";

export const CHANGED_MEANWHILE =
  "Someone else changed this while you were editing it. Reload the page to see their change, then make yours.";

export function assertUnchanged(request: FastifyRequest, before: object): void {
  const seen = request.headers[RECORD_VERSION_HEADER];
  if (typeof seen !== "string" || !seen) return;
  const now = (before as { updated_at?: unknown }).updated_at;
  if (typeof now === "string" && now !== seen) throw conflict(CHANGED_MEANWHILE);
}

/** The change itself sets the new time, so the saved record it returns is the one the page keeps. */
const TOUCH = "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/**
 * For the update statement itself (go-live review, 15 Nov 2026): the check
 * above reads the record a moment before the update, so a save landing in
 * between could still be overwritten. This adds the new time to `sets`, and
 * returns a condition for the `where` that matches only the version the page
 * saw. An update that then changes no row was beaten to it: throw
 * `changedMeanwhile()`.
 */
export function versioned(request: FastifyRequest, before: object, sets: string[], params: unknown[]): string {
  if (!("updated_at" in before)) return "";
  sets.push(TOUCH);
  const seen = request.headers[RECORD_VERSION_HEADER];
  if (typeof seen !== "string" || !seen) return "";
  params.push(seen);
  return ` and updated_at = $${params.length}`;
}

export const changedMeanwhile = (): Error => conflict(CHANGED_MEANWHILE);

/**
 * A file attached to or removed from a record changes the record's version
 * without the record coming back in the answer. These two headers tell the
 * page the new version, so its next save of that record is not refused as if
 * somebody else had changed it (go-live review, 15 Nov 2026).
 */
export function tellNewVersion(reply: FastifyReply, row: { id?: unknown; updated_at?: unknown } | undefined): void {
  if (typeof row?.id !== "string" || typeof row.updated_at !== "string") return;
  reply.header("x-record-id", row.id).header(RECORD_VERSION_HEADER, row.updated_at);
}
