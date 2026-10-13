import argon2 from "argon2";

/**
 * Argon2id with OWASP-recommended parameters (2024): 19 MiB memory, 2 passes.
 * Tuned to stay under ~100ms on a modest on-prem server.
 */
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed hash must never throw its way to the caller as "success".
    return false;
  }
}

/** Returns true when a stored hash was made with weaker settings and should be re-hashed on next login. */
export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, OPTIONS);
}

const MIN_LENGTH = 12;

export function validatePasswordStrength(plain: string): string | null {
  if (plain.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters.`;
  if (/^\s|\s$/.test(plain)) return "Password must not start or end with a space.";
  return null;
}
