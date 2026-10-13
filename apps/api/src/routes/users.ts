import type { FastifyInstance } from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { query, withTransaction } from "../db/pool.js";
import { isAdmin, requireAuth } from "../auth/rbac.js";
import { ROLES } from "../auth/session.js";
import { hashPassword, validatePasswordStrength } from "../auth/password.js";
import { audit } from "../audit/audit.js";
import { accountCreated, invitation, passwordChanged } from "../mail/notify.js";
import { loadSmtp } from "../mail/mailer.js";
import { INVITATION_HOURS, issueTemporaryPassword, issuedInLastHour, MAX_PER_HOUR, spendAll } from "../auth/temporary.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { nowIso } from "../lib/time.js";

/**
 * User administration.
 *
 * Two rules run through all of it, and both exist to stop an administrator
 * locking everyone out of their own system:
 *
 *  - You cannot disable your own account or take away your own admin role. An
 *    administrator who does that by accident has no way back in.
 *  - The last enabled administrator cannot be disabled or demoted. There is no
 *    self-service reset for anyone but administrators, and an instance with no
 *    administrator is an instance nobody can administer.
 *
 * Accounts are disabled, never deleted. The audit log points at them, and
 * "who approved this" losing its answer is exactly what an audit trail is for.
 */

const idParam = z.object({ id: z.string().uuid() });

const createBody = z
  .object({
    username: z
      .string()
      .min(3)
      .max(100)
      .regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, dot, dash and underscore only."),
    name: z.string().min(1).max(200),
    email: z.string().email(),
    role: z.enum(ROLES),
    /**
     * Either a password the administrator chooses, or an invitation, in which
     * case nobody chooses one: the person is emailed a one-time password and
     * picks their own.
     */
    password: z.string().optional(),
    invite: z.boolean().optional(),
  })
  .strict();

const patchBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    email: z.string().email().optional(),
    role: z.enum(ROLES).optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

const passwordBody = z.object({ password: z.string() }).strict();

interface UserRow {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  auth_source: string;
  disabled: number;
  last_login_at: string | null;
  locked_until: string | null;
  failed_logins: number;
  created_at: string;
  /** 1 when an invitation has been sent that can still be used. */
  invited: number;
}

const SELECT = `select id, username, name, email, role, auth_source, disabled,
                       last_login_at, locked_until, failed_logins, created_at,
                       (select count(*) > 0 from password_resets r
                         where r.user_id = users.id and r.kind = 'invite'
                           and r.used_at is null
                           and r.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) as invited
                  from users`;

async function byId(id: string): Promise<UserRow> {
  const { rows } = await query<UserRow>(`${SELECT} where id = $1`, [id]);
  if (!rows[0]) throw notFound("No such user.");
  return rows[0];
}

/** How many administrators could still sign in if this one stopped being able to. */
async function otherActiveAdmins(excludingId: string): Promise<number> {
  const { rows } = await query<{ n: number }>(
    "select count(*) as n from users where role = 'admin' and disabled = 0 and id <> $1",
    [excludingId],
  );
  return rows[0]?.n ?? 0;
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/users", { preHandler: isAdmin }, async () => {
    const { rows } = await query<UserRow>(`${SELECT} order by disabled, username`);
    return { users: rows };
  });

  app.post("/api/v1/users", { preHandler: isAdmin }, async (request, reply) => {
    requireAuth(request);
    const body = createBody.parse(request.body);
    const inviting = body.invite === true;

    if (inviting) {
      if (body.password !== undefined) {
        throw badRequest("Either invite them or choose a password for them, not both.");
      }
      // An invitation that cannot be sent is a person nobody can let in.
      if (!(await loadSmtp()).enabled) {
        throw badRequest(
          "Email is not set up, so nobody can be invited yet. Set it up under Settings, " +
            "or choose a password for them instead.",
        );
      }
    } else {
      if (body.password === undefined) {
        throw badRequest("Choose a password for them, or invite them by email.");
      }
      const complaint = validatePasswordStrength(body.password);
      if (complaint) throw badRequest(complaint);
    }

    const taken = await query("select 1 from users where lower(username) = lower($1)", [
      body.username,
    ]);
    if (taken.rows.length) throw conflict("That username is already taken.");

    const id = randomUUID();
    // An invited person has no password yet. The row needs one (SSO aside, a
    // local account must have a hash), so it gets a random one that nobody
    // knows, including us: the one-time password is the only way in.
    const hash = await hashPassword(inviting ? randomBytes(32).toString("base64url") : body.password!);
    await query(
      `insert into users (id, username, name, email, role, auth_source, password_hash)
       values ($1, $2, $3, $4, $5, 'local', $6)`,
      [id, body.username, body.name, body.email, body.role, hash],
    );

    if (inviting) {
      const person = { name: body.name, username: body.username, email: body.email, role: body.role };
      const temporary = await issueTemporaryPassword(id, request.ip, "invite");
      const sent = await invitation(
        person, temporary, INVITATION_HOURS, request.user?.name ?? "An administrator",
      );
      if (!sent.sent) {
        // Nobody received it, so there is nobody to sign in. Take the account
        // back rather than leave one that nothing can open.
        await query("delete from users where id = $1", [id]);
        throw badRequest(
          `The invitation email could not be sent (${sent.reason ?? "no reason given"}), ` +
            "so nothing was created. Check Settings, then Email, or choose a password for them instead.",
        );
      }
      const invited = await byId(id);
      await audit(request, {
        action: "User invited",
        entity: "user",
        entityId: id,
        after: { username: invited.username, role: invited.role },
      });
      reply.code(201);
      return { user: invited, invited: true };
    }

    const created = await byId(id);
    await audit(request, {
      action: "User added",
      entity: "user",
      entityId: id,
      after: { username: created.username, role: created.role },
    });

    // Tell them the account exists. Never blocks: a mail server being down is
    // not a reason for the account not to have been created, and the result is
    // logged rather than thrown so nobody has to guess whether it went.
    const told = await accountCreated(
      {
        name: created.name,
        username: created.username,
        email: created.email,
        role: created.role,
      },
      request.user?.name ?? "An administrator",
    );
    request.log.info(
      { user: created.username, sent: told.sent, reason: told.reason },
      "account created notification",
    );
    reply.code(201);
    return { user: created };
  });

  /**
   * Sends the invitation again.
   *
   * For a person who has not signed in yet and has lost the email, or let it
   * expire. The earlier one stops working at the same moment.
   */
  app.post("/api/v1/users/:id/invite", { preHandler: isAdmin }, async (request) => {
    requireAuth(request);
    const { id } = idParam.parse(request.params);
    const user = await byId(id);
    if (user.auth_source !== "local") throw badRequest("That account signs in through single sign-on.");
    if (user.disabled) throw badRequest("That account is disabled.");
    if (user.last_login_at) {
      throw badRequest("They have already signed in. If they forgot their password, set a new one for them.");
    }
    if ((await issuedInLastHour(id)) >= MAX_PER_HOUR) {
      throw badRequest("Several have just been sent. Wait an hour, or choose a password for them.");
    }
    if (!(await loadSmtp()).enabled) throw badRequest("Email is not set up.");

    const temporary = await issueTemporaryPassword(id, request.ip, "invite");
    const sent = await invitation(
      { name: user.name, username: user.username, email: user.email, role: user.role },
      temporary, INVITATION_HOURS, request.user?.name ?? "An administrator",
    );
    if (!sent.sent) {
      await spendAll(id);
      throw badRequest(`The invitation email could not be sent (${sent.reason ?? "no reason given"}).`);
    }
    await audit(request, { action: "Invitation sent again", entity: "user", entityId: id });
    return { user: await byId(id), invited: true };
  });

  app.patch("/api/v1/users/:id", { preHandler: isAdmin }, async (request) => {
    requireAuth(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);
    const before = await byId(id);

    const losingAdmin =
      (body.role !== undefined && before.role === "admin" && body.role !== "admin") ||
      body.disabled === true;

    if (losingAdmin && id === request.user.id) {
      throw badRequest(
        body.disabled === true
          ? "You cannot disable your own account."
          : "You cannot remove your own administrator role.",
      );
    }
    // Belt and braces. Today the rule above already guarantees this: only an
    // enabled admin can reach here, so any *other* admin they act on always has
    // at least one admin left behind them. That stops being true the moment
    // admins can be provisioned or removed by something other than this screen
    // — SSO group mapping, for one — so the invariant is checked directly.
    if (losingAdmin && before.role === "admin" && (await otherActiveAdmins(id)) === 0) {
      throw badRequest(
        "This is the last active administrator. Give someone else the administrator role first.",
      );
    }

    const COLUMN: Record<string, string> = {
      name: "name",
      email: "email",
      role: "role",
      disabled: "disabled",
    };
    const entries = Object.entries(body).filter(([k]) => k in COLUMN);
    if (entries.length === 0) return { user: before };

    await withTransaction(async (tx) => {
      const sets = entries.map(([k], i) => `${COLUMN[k]} = $${i + 2}`);
      await tx.query(`update users set ${sets.join(", ")} where id = $1`, [
        id,
        ...entries.map(([, v]) => (typeof v === "boolean" ? (v ? 1 : 0) : v)),
      ]);
      // A disabled account must not keep working until its cookie expires.
      if (body.disabled === true) {
        await tx.query("delete from sessions where user_id = $1", [id]);
      }
    });

    const after = await byId(id);
    await audit(request, { action: "User updated", entity: "user", entityId: id, before, after });
    return { user: after };
  });

  app.post("/api/v1/users/:id/password", { preHandler: isAdmin }, async (request) => {
    requireAuth(request);
    const { id } = idParam.parse(request.params);
    const { password } = passwordBody.parse(request.body);
    const user = await byId(id);

    if (user.auth_source !== "local") {
      throw badRequest("This account signs in through your identity provider.");
    }
    const complaint = validatePasswordStrength(password);
    if (complaint) throw badRequest(complaint);

    const hash = await hashPassword(password);
    await withTransaction(async (tx) => {
      // Clear any lockout at the same time: the usual reason for a reset is
      // that someone locked themselves out.
      await tx.query(
        "update users set password_hash = $1, failed_logins = 0, locked_until = null where id = $2",
        [hash, id],
      );
      // Every existing session for that account is now suspect.
      await tx.query("delete from sessions where user_id = $1", [id]);
    });

    const subject = await byId(id);
    // Sent even though the password itself is not in it. Somebody whose
    // password was changed without asking should hear about it.
    const warned = await passwordChanged(
      {
        name: subject.name,
        username: subject.username,
        email: subject.email,
        role: subject.role,
      },
      request.user?.name ?? "An administrator",
    );
    request.log.info(
      { user: subject.username, sent: warned.sent, reason: warned.reason },
      "password changed notification",
    );

    await audit(request, {
      action: "Password reset",
      entity: "user",
      entityId: id,
      after: { username: user.username },
    });
    return { user: await byId(id) };
  });

  app.post("/api/v1/users/:id/unlock", { preHandler: isAdmin }, async (request) => {
    requireAuth(request);
    const { id } = idParam.parse(request.params);
    const user = await byId(id);

    await query("update users set failed_logins = 0, locked_until = null where id = $1", [id]);
    await audit(request, {
      action: "User unlocked",
      entity: "user",
      entityId: id,
      before: { lockedUntil: user.locked_until, failedLogins: user.failed_logins },
    });
    return { user: await byId(id) };
  });

  /** Whether an account is locked right now, for the screen to show. */
  app.get("/api/v1/users/:id", { preHandler: isAdmin }, async (request) => {
    const { id } = idParam.parse(request.params);
    const user = await byId(id);
    return {
      user,
      locked: Boolean(user.locked_until && user.locked_until > nowIso()),
    };
  });
}
