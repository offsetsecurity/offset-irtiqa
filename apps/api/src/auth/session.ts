import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { query } from "../db/pool.js";
import { config, isProd } from "../config.js";
import { isoInHours, isoAgo, nowIso } from "../lib/time.js";

export const SESSION_COOKIE = "offset_sid";
export const CSRF_COOKIE = "offset_csrf";
export const CSRF_HEADER = "x-csrf-token";

/** The four roles, in one place so routes and validation cannot drift apart. */
export const ROLES = ["admin", "contributor", "auditor", "readonly"] as const;
export type UserRole = (typeof ROLES)[number];

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: UserRole;
  /**
   * Signed in with a temporary password. Until a new password is chosen this
   * session can do nothing else; see the guard in app.ts.
   */
  mustChangePassword?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
    sessionId?: string;
  }
}

const newId = (): string => randomBytes(32).toString("base64url");

function sign(value: string): string {
  return createHmac("sha256", config.SESSION_SECRET).update(value).digest("base64url");
}

/** `<sid>.<hmac>` — the hmac stops an attacker forging a session id. */
function seal(sid: string): string {
  return `${sid}.${sign(sid)}`;
}

function unseal(sealed: string | undefined): string | null {
  if (!sealed) return null;
  const idx = sealed.lastIndexOf(".");
  if (idx <= 0) return null;
  const sid = sealed.slice(0, idx);
  const mac = sealed.slice(idx + 1);
  const a = Buffer.from(mac);
  const b = Buffer.from(sign(sid));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return sid;
}

export async function createSession(
  reply: FastifyReply,
  user: SessionUser,
  meta: { ip?: string; userAgent?: string; mustChangePassword?: boolean },
): Promise<void> {
  const sid = newId();
  const expiresAt = isoInHours(config.SESSION_TTL_HOURS);

  await query(
    `insert into sessions (sid, user_id, ip, user_agent, expires_at, must_change_password)
     values ($1, $2, $3, $4, $5, $6)`,
    [sid, user.id, meta.ip ?? null, meta.userAgent ?? null, expiresAt, meta.mustChangePassword ? 1 : 0],
  );

  const common = {
    path: "/",
    httpOnly: true,
    /**
     * Set only on an HTTPS connection, judged per request.
     *
     * It used to be `isProd`, which is a guess about the connection made
     * from an unrelated setting. A browser refuses to send a Secure cookie
     * over plain HTTP, so a production install reached over HTTP from
     * another machine silently failed to sign anyone in. It appeared to work
     * only because browsers make an exception for localhost.
     *
     * `protocol` accounts for a proxy's X-Forwarded-Proto, because trustProxy
     * is on, so TLS terminated in front of us still counts.
     */
    secure: reply.request.protocol === "https",
    sameSite: "lax" as const,
    expires: new Date(expiresAt),
  };

  reply.setCookie(SESSION_COOKIE, seal(sid), common);
  // Double-submit CSRF token: readable by the SPA, echoed back in a header.
  reply.setCookie(CSRF_COOKIE, newId(), { ...common, httpOnly: false });
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sid = unseal(request.cookies[SESSION_COOKIE]);
  if (sid) await query("delete from sessions where sid = $1", [sid]);
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
  reply.clearCookie(CSRF_COOKIE, { path: "/" });
}

/** Loads the session user onto the request. Never throws — routes decide what to require. */
export async function loadSession(request: FastifyRequest): Promise<void> {
  const sid = unseal(request.cookies[SESSION_COOKIE]);
  if (!sid) return;

  const { rows } = await query<SessionUser & { last_seen_at: string; must_change_password: number }>(
    `select u.id, u.username, u.name, u.email, u.role, s.last_seen_at, s.must_change_password
       from sessions s
       join users u on u.id = s.user_id
      where s.sid = $1 and s.expires_at > $2 and u.disabled = 0`,
    [sid, nowIso()],
  );

  const row = rows[0];
  if (!row) return;

  request.user = {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email,
    role: row.role,
    ...(row.must_change_password ? { mustChangePassword: true } : {}),
  };
  request.sessionId = sid;

  // Sliding expiry, but only write once a minute so we are not issuing an
  // UPDATE — and taking SQLite's single write lock — on every request.
  if (row.last_seen_at < isoAgo(60_000)) {
    void query("update sessions set last_seen_at = $2, expires_at = $3 where sid = $1", [
      sid,
      nowIso(),
      isoInHours(config.SESSION_TTL_HOURS),
    ]).catch(() => {});
  }
}

export function verifyCsrf(request: FastifyRequest): boolean {
  const cookie = request.cookies[CSRF_COOKIE];
  const header = request.headers[CSRF_HEADER];
  if (!cookie || typeof header !== "string") return false;
  const a = Buffer.from(cookie);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * After a password change: this session may carry on, every other one ends.
 *
 * Anybody still signed in elsewhere was signed in with the old password, and
 * the usual reason for changing one is that it may be known to somebody else.
 */
export async function afterPasswordChange(userId: string, keepSid: string | undefined): Promise<void> {
  await query("delete from sessions where user_id = $1 and sid <> $2", [userId, keepSid ?? ""]);
  if (keepSid) {
    await query("update sessions set must_change_password = 0 where sid = $1", [keepSid]);
  }
}

/** Housekeeping — called by the worker on a schedule. */
export async function purgeExpiredSessions(): Promise<number> {
  const { rowCount } = await query("delete from sessions where expires_at < $1", [nowIso()]);
  return rowCount;
}
