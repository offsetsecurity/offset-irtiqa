import type { FastifyReply, FastifyRequest } from "fastify";
import type { UserRole } from "./session.js";
import { verifyCsrf } from "./session.js";
import { HttpError } from "../lib/errors.js";

/**
 * Roles, most privileged first.
 *  admin       — everything, plus users / backup / licence / SSO / SMTP
 *  contributor — read and write all GRC data
 *  auditor     — read everything, plus the security audit log; no writes
 *  readonly    — read everything; every write is rejected
 */
const RANK: Record<UserRole, number> = {
  admin: 3,
  contributor: 2,
  auditor: 1,
  readonly: 0,
};

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function requireAuth(request: FastifyRequest): asserts request is FastifyRequest & {
  user: NonNullable<FastifyRequest["user"]>;
} {
  if (!request.user) throw new HttpError(401, "Not signed in.");
}

/** A route guard that says which roles it lets through, so tests can check every route. */
export type Guard = ((request: FastifyRequest, reply: FastifyReply) => Promise<void>) & { allowed: UserRole[] };

/** Route guard: minimum role. Also enforces CSRF on state-changing methods. */
export function requireRole(minimum: UserRole): Guard {
  const guard = async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    requireAuth(request);

    if (WRITE_METHODS.has(request.method) && !verifyCsrf(request)) {
      throw new HttpError(403, "Missing or invalid CSRF token.");
    }

    if (RANK[request.user.role] < RANK[minimum]) {
      throw new HttpError(403, "Your role does not permit this action.");
    }
  };
  return Object.assign(guard, {
    allowed: (Object.keys(RANK) as UserRole[]).filter((r) => RANK[r] >= RANK[minimum]),
  });
}

/** Anyone signed in may read. */
export const canRead = requireRole("readonly");
/** Contributor and above may write. Auditor and readonly are rejected. */
export const canWrite = requireRole("contributor");
/** Admin only. */
export const isAdmin = requireRole("admin");

/**
 * Second line of defence — call this inside services, not just in middleware,
 * so a route wired up without a guard still cannot mutate data.
 */
export function assertCanWrite(role: UserRole): void {
  if (RANK[role] < RANK.contributor) {
    throw new HttpError(403, "Your role does not permit this action.");
  }
}
