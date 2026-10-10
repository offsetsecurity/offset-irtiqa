import { randomInt, randomUUID } from "node:crypto";
import { query, withTransaction } from "../db/pool.js";
import { isoAgo, isoIn, nowIso } from "../lib/time.js";
import { hashPassword, verifyPassword } from "./password.js";

/**
 * Temporary passwords for an administrator who has forgotten theirs.
 *
 * One works once, for thirty minutes, and only lets its holder choose a new
 * password. The account's real password is left alone until then, so a
 * stranger who types an administrator's username into "Forgot password?"
 * achieves nothing but an email in that administrator's inbox.
 */

export const TEMPORARY_MINUTES = 30;

/**
 * How long an invitation lasts. Longer than a reset, because the person asking
 * for a reset is sitting at the sign-in page and a person who has been invited
 * may not open their mail until tomorrow. Still single use, and it only ever
 * opens the page that chooses a password.
 */
export const INVITATION_HOURS = 72;

export type TemporaryKind = "reset" | "invite";

/** More than this many in an hour and further requests are quietly ignored. */
export const MAX_PER_HOUR = 3;

// No 0/O, 1/l/i: this gets read off a phone and typed on a keyboard.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * Sixteen characters in four groups, about 79 bits: far beyond guessing within
 * thirty minutes, even before the account lockout, and easy to type.
 */
export function generateTemporaryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = "";
    for (let i = 0; i < 4; i++) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join("-");
}

/** How many were issued for this account within the last hour. */
export async function issuedInLastHour(userId: string): Promise<number> {
  const { rows } = await query<{ n: number }>(
    "select count(*) as n from password_resets where user_id = $1 and created_at > $2",
    [userId, isoAgo(3_600_000)],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Issues a temporary password and returns it, once, in plain text.
 *
 * Any earlier one still outstanding is spent at the same moment, so only the
 * newest email can be used.
 */
export async function issueTemporaryPassword(
  userId: string,
  ip: string | null,
  kind: TemporaryKind = "reset",
): Promise<string> {
  const plain = generateTemporaryPassword();
  const lifetime = kind === "invite" ? INVITATION_HOURS * 3_600_000 : TEMPORARY_MINUTES * 60_000;
  const hash = await hashPassword(plain);
  const now = nowIso();
  await withTransaction(async (tx) => {
    await tx.query(
      "update password_resets set used_at = $2 where user_id = $1 and used_at is null",
      [userId, now],
    );
    await tx.query(
      `insert into password_resets (id, user_id, password_hash, expires_at, requested_ip, kind)
       values ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), userId, hash, isoIn(lifetime), ip, kind],
    );
  });
  return plain;
}

/**
 * Spends a temporary password if `plain` is the outstanding one.
 *
 * Marked used in the same statement that checks it is unused, so two sign-ins
 * racing with the same password cannot both succeed.
 */
export async function useTemporaryPassword(
  userId: string,
  plain: string,
  kinds: readonly TemporaryKind[] = ["reset"],
): Promise<boolean> {
  const { rows } = await query<{ id: string; password_hash: string }>(
    `select id, password_hash from password_resets
      where user_id = $1 and used_at is null and expires_at > $2
        and kind in (${kinds.map((_, i) => `$${i + 3}`).join(", ")})
      order by created_at desc limit 1`,
    [userId, nowIso(), ...kinds],
  );
  const row = rows[0];
  if (!row || !(await verifyPassword(row.password_hash, plain))) return false;

  const { rowCount } = await query(
    "update password_resets set used_at = $2 where id = $1 and used_at is null",
    [row.id, nowIso()],
  );
  return rowCount === 1;
}

/** Spends everything outstanding, for when the password has been changed. */
export async function spendAll(userId: string): Promise<void> {
  await query("update password_resets set used_at = $2 where user_id = $1 and used_at is null", [
    userId,
    nowIso(),
  ]);
}
