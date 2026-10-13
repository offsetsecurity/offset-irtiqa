import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { query } from "../db/pool.js";
import { nowIso } from "../lib/time.js";
import { hashPassword, needsRehash, validatePasswordStrength, verifyPassword } from "../auth/password.js";
import {
  afterPasswordChange, createSession, destroySession, type SessionUser, type UserRole,
} from "../auth/session.js";
import { requireAuth, isAdmin, canRead } from "../auth/rbac.js";
import { audit, auditAnonymous } from "../audit/audit.js";
import { noteSignIn } from "../lib/signin-log.js";
import { badRequest, HttpError } from "../lib/errors.js";
import {
  issuedInLastHour, issueTemporaryPassword, MAX_PER_HOUR, spendAll, TEMPORARY_MINUTES,
  useTemporaryPassword,
} from "../auth/temporary.js";
import { ownPasswordChanged, temporaryPassword } from "../mail/notify.js";
import {
  ADDRESS_MAX_FAILED, ADDRESS_WINDOW_MINUTES, addressBlocked, noteAddressFailure,
} from "../auth/address-limit.js";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const loginBody = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(400),
});

const forgotBody = z.object({ identifier: z.string().trim().min(1).max(320) }).strict();

const changeBody = z
  .object({
    currentPassword: z.string().max(400).optional(),
    newPassword: z.string().max(400),
  })
  .strict();

/**
 * The same words whatever happened.
 *
 * Whether the name was an administrator, whether it exists, whether it has an
 * email address and whether email is even set up are all things a stranger at
 * the sign-in page would like to learn, one guess at a time.
 */
const FORGOT_REPLY =
  "If that is an administrator account with an email address, a temporary password " +
  "is on its way to it. It works once, for 30 minutes. If nothing arrives, email may " +
  "not be set up on this server: ask another administrator, or whoever runs the " +
  "server, to reset it.";

interface Logger {
  error: (obj: object, msg: string) => void;
}

/**
 * One reset at a time per account.
 *
 * The hourly limit is a count followed by an insert, with a password hash in
 * between. Five requests fired together all counted zero before any of them
 * had inserted, and all five were sent. Queuing them per account makes each
 * one count the ones before it.
 */
const resetQueue = new Map<string, Promise<void>>();

function oneAtATime(key: string, work: () => Promise<void>): Promise<void> {
  const previous = resetQueue.get(key) ?? Promise.resolve();
  const next = previous.then(work, work);
  resetQueue.set(key, next);
  void next.finally(() => {
    if (resetQueue.get(key) === next) resetQueue.delete(key);
  });
  return next;
}

/**
 * Finds the administrator and emails them a temporary password.
 *
 * Run after the reply has gone, never before. Hashing a password and talking
 * to a mail server take a noticeable time, and a reply that came back slower
 * for real administrators than for made-up names would answer the question
 * FORGOT_REPLY is careful not to.
 */
async function sendTemporaryPassword(identifier: string, ip: string, log: Logger): Promise<void> {
  try {
    const { rows } = await query<UserRow>(
      `select id, username, name, email, role, password_hash, disabled, failed_logins, locked_until
         from users
        where (lower(username) = lower($1) or lower(email) = lower($1))
          and role = 'admin' and disabled = 0 and auth_source = 'local'`,
      [identifier],
    );
    if (rows.length === 0) {
      await auditAnonymous(ip, "Password reset requested", `${identifier}: no such administrator`);
      return;
    }

    for (const row of rows) {
      if (!row.email.trim()) {
        await auditAnonymous(ip, "Password reset refused", `${row.username}: no email address`);
        continue;
      }
      await oneAtATime(row.id, async () => {
        if ((await issuedInLastHour(row.id)) >= MAX_PER_HOUR) {
          await auditAnonymous(ip, "Password reset refused", `${row.username}: too many requests this hour`);
          return;
        }

        const temporary = await issueTemporaryPassword(row.id, ip);
        const sent = await temporaryPassword(
          { name: row.name, username: row.username, email: row.email, role: row.role },
          temporary,
          TEMPORARY_MINUTES,
          ip,
        );
        if (sent.sent) {
          await auditAnonymous(ip, "Temporary password emailed", row.username);
        } else {
          // Nobody received it, so nobody should be able to use it.
          await spendAll(row.id);
          await auditAnonymous(ip, "Password reset email failed", `${row.username}: ${sent.reason ?? "not sent"}`);
        }
      });
    }
  } catch (err) {
    log.error({ err }, "sending a temporary password failed");
  }
}

const bootstrapBody = z.object({
  username: z.string().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string(),
});

interface UserRow {
  id: string;
  username: string;
  name: string;
  email: string;
  role: UserRole;
  password_hash: string | null;
  disabled: number;
  failed_logins: number;
  locked_until: string | null;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** Has an admin been created yet? Drives the first-run wizard in the SPA. */
  app.get("/api/v1/auth/bootstrap", async () => {
    const { rows } = await query<{ n: number }>("select count(*) as n from users");
    return { needsBootstrap: (rows[0]?.n ?? 0) === 0 };
  });

  /** First-run only: create the initial admin. Refuses once any user exists. */
  app.post("/api/v1/auth/bootstrap", async (request, reply) => {
    // Check the door is still open before doing anything else — a closed
    // endpoint should not reveal how its payload is validated.
    const { rows } = await query<{ n: number }>("select count(*) as n from users");
    if ((rows[0]?.n ?? 0) > 0) {
      throw new HttpError(409, "Setup has already been completed.");
    }

    const body = bootstrapBody.parse(request.body);

    const strength = validatePasswordStrength(body.password);
    if (strength) throw badRequest(strength);

    const hash = await hashPassword(body.password);
    const { rows: created } = await query<UserRow>(
      `insert into users (id, username, name, email, role, auth_source, password_hash)
       values ($1, $2, $3, $4, 'admin', 'local', $5)
       returning id, username, name, email, role`,
      [randomUUID(), body.username, body.name, body.email, hash],
    );

    const user = created[0]!;
    await auditAnonymous(request.ip, "Bootstrap admin created", user.username);
    await createSession(reply, user as SessionUser, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });

    reply.code(201);
    return { user };
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const body = loginBody.parse(request.body);

    // Before any account is looked at, so an address past its limit can
    // neither guess nor push anyone's account into a lockout.
    const address = request.ip;
    if (addressBlocked(address)) {
      throw new HttpError(
        429,
        `Too many failed sign-ins from this address. Try again in ${ADDRESS_WINDOW_MINUTES} minutes.`,
      );
    }

    const { rows } = await query<UserRow>(
      `select id, username, name, email, role, password_hash, disabled, failed_logins, locked_until
         from users where username = $1`,
      [body.username],
    );
    const row = rows[0];

    // One generic message for every failure mode — do not leak which part was wrong.
    const reject = async (reason: string): Promise<never> => {
      await auditAnonymous(address, "Login failed", `${body.username}: ${reason}`);
      noteSignIn("FAILED", body.username, address, reason);
      // Recorded once, at the moment it happens, rather than for every
      // refusal after it.
      if (noteAddressFailure(address) === ADDRESS_MAX_FAILED) {
        noteSignIn("BLOCKED", body.username, address, `${ADDRESS_MAX_FAILED} failed sign-ins in ${ADDRESS_WINDOW_MINUTES} minutes; this address is paused`);
        await auditAnonymous(
          address,
          "Sign-in blocked for this address",
          `${ADDRESS_MAX_FAILED} failed sign-ins in ${ADDRESS_WINDOW_MINUTES} minutes`,
        );
      }
      throw new HttpError(401, "Incorrect username or password.");
    };

    if (!row || !row.password_hash) return reject("no such user");
    if (row.disabled) return reject("account disabled");
    const locked = Boolean(row.locked_until && row.locked_until > nowIso());

    // The real password, unless the account is locked out.
    let ok = !locked && (await verifyPassword(row.password_hash, body.password));

    // Otherwise an administrator's temporary password, which works through a
    // lockout: being locked out is the usual reason for asking for one, and at
    // sixteen random characters, spent on first use, it is not what the lockout
    // is protecting against.
    // An invitation is for anybody; a reset only for an administrator.
    let temporary = false;
    if (!ok) {
      temporary = await useTemporaryPassword(
        row.id,
        body.password,
        row.role === "admin" ? ["reset", "invite"] : ["invite"],
      );
      ok = temporary;
    }

    if (!ok && locked) return reject("account locked");
    if (!ok) {
      const failed = row.failed_logins + 1;
      const lockUntil =
        failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
      await query("update users set failed_logins = $2, locked_until = $3 where id = $1", [
        row.id,
        failed,
        lockUntil,
      ]);
      if (lockUntil) noteSignIn("LOCKED", row.username, address, `${failed} wrong passwords; locked for ${LOCK_MINUTES} minutes`);
      return reject("bad password");
    }

    // Transparently upgrade the hash if our parameters have since been raised.
    if (!temporary && needsRehash(row.password_hash)) {
      const fresh = await hashPassword(body.password);
      await query("update users set password_hash = $2 where id = $1", [row.id, fresh]);
    }

    await query(
      "update users set failed_logins = 0, locked_until = null, last_login_at = $2 where id = $1",
      [row.id, nowIso()],
    );

    const user: SessionUser = {
      id: row.id,
      username: row.username,
      name: row.name,
      email: row.email,
      role: row.role,
      ...(temporary ? { mustChangePassword: true } : {}),
    };
    await createSession(reply, user, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      mustChangePassword: temporary,
    });
    request.user = user;
    await audit(request, {
      action: temporary ? "Signed in with a temporary password" : "Signed in",
      entity: "user",
      entityId: row.id,
    });

    return { user };
  });

  /**
   * "Forgot password?" on the sign-in page. Administrators only.
   *
   * Answers immediately and identically every time; the work happens after.
   * Limited per address as well as per account, so the form cannot be used to
   * fill an administrator's inbox.
   */
  app.post(
    "/api/v1/auth/forgot",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request) => {
      const { identifier } = forgotBody.parse(request.body);
      void sendTemporaryPassword(identifier, request.ip, request.log);
      return { ok: true, message: FORGOT_REPLY };
    },
  );

  /**
   * Choosing a new password: after signing in with a temporary one, or at any
   * time from Profile.
   *
   * The current password is required except straight after a temporary one,
   * where the whole point is that it has been forgotten. Every other session
   * for the account ends, and any temporary password still outstanding is
   * spent.
   */
  app.post("/api/v1/auth/password", { preHandler: canRead }, async (request) => {
    requireAuth(request);
    const body = changeBody.parse(request.body);

    const { rows } = await query<{ password_hash: string | null; auth_source: string }>(
      "select password_hash, auth_source from users where id = $1",
      [request.user.id],
    );
    const row = rows[0];
    if (!row || row.auth_source !== "local" || !row.password_hash) {
      throw badRequest("This account signs in through your identity provider.");
    }

    if (!request.user.mustChangePassword) {
      if (!body.currentPassword || !(await verifyPassword(row.password_hash, body.currentPassword))) {
        throw badRequest("Your current password is not right.");
      }
    }

    const complaint = validatePasswordStrength(body.newPassword);
    if (complaint) throw badRequest(complaint);
    if (await verifyPassword(row.password_hash, body.newPassword)) {
      throw badRequest("Choose a password different from your current one.");
    }

    await query(
      `update users set password_hash = $2, failed_logins = 0, locked_until = null,
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        where id = $1`,
      [request.user.id, await hashPassword(body.newPassword)],
    );
    await spendAll(request.user.id);
    await afterPasswordChange(request.user.id, request.sessionId);

    await audit(request, {
      action: request.user.mustChangePassword ? "Password chosen after a temporary password" : "Password changed",
      entity: "user",
      entityId: request.user.id,
    });

    const { mustChangePassword: _done, ...user } = request.user;
    void ownPasswordChanged({ name: user.name, username: user.username, email: user.email, role: user.role })
      .catch(() => undefined);

    return { user };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    if (request.user) {
      await audit(request, { action: "Signed out", entity: "user", entityId: request.user.id });
    }
    await destroySession(request, reply);
    return { ok: true };
  });

  app.get("/api/v1/auth/me", async (request) => {
    requireAuth(request);
    return { user: request.user };
  });

  /** Admin-only listing, so the SPA can render the user-management screen. */
}
