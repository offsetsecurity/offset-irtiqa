import { auditAnonymous } from "../audit/audit.js";
import { pool, query } from "../db/pool.js";
import { issueTemporaryPassword, TEMPORARY_MINUTES } from "../auth/temporary.js";

/**
 * A temporary password for an administrator, issued at the server itself.
 *
 * For when "Forgot password?" cannot help: email is not set up, or the only
 * administrator's address is wrong. Whoever can run this already controls the
 * server and its database, so it grants nothing they could not take anyway;
 * what it saves them is editing the database by hand.
 *
 * It works like the emailed kind - once, for thirty minutes, and only to choose
 * a new password - and it is written to the audit log.
 *
 *   Docker    docker compose exec app node dist/admin/reset-password.js <username>
 *   Linux     see "Locked out" in INSTALL.md
 *   Windows   see "Locked out" in INSTALL.md
 */

async function main(): Promise<number> {
  const username = process.argv[2]?.trim();
  if (!username) {
    console.error("Usage: reset-password.js <administrator username>");
    return 2;
  }

  const { rows } = await query<{ id: string; username: string; role: string; disabled: number; auth_source: string }>(
    "select id, username, role, disabled, auth_source from users where lower(username) = lower($1)",
    [username],
  );
  const user = rows[0];
  if (!user) {
    console.error(`There is no user called ${username}.`);
    return 1;
  }
  if (user.role !== "admin") {
    console.error(`${user.username} is not an administrator. Sign in as an administrator and reset it from People.`);
    return 1;
  }
  if (user.disabled) {
    console.error(`${user.username} is disabled.`);
    return 1;
  }
  if (user.auth_source !== "local") {
    console.error(`${user.username} signs in through your identity provider, not with a password.`);
    return 1;
  }

  const temporary = await issueTemporaryPassword(user.id, null);
  await auditAnonymous("server console", "Temporary password issued at the server", user.username);

  console.log("");
  console.log(`  Temporary password for ${user.username}:`);
  console.log("");
  console.log(`      ${temporary}`);
  console.log("");
  console.log(`  It works once, in the next ${TEMPORARY_MINUTES} minutes. Sign in with it and you`);
  console.log("  will be asked to choose a new password straight away.");
  console.log("");
  return 0;
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (err: Error) => {
    console.error(`Could not issue a temporary password: ${err.message}`);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
