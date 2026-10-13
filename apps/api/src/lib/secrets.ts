/**
 * Encrypting the few secrets this product has to store and read back.
 *
 * A password hash is one-way and never needs reversing. An SMTP password does:
 * the product has to hand it to a mail server on every send. So it cannot be
 * hashed, and storing it as plain text in the settings table would put it in
 * every backup and every copy of the database anyone takes.
 *
 * AES-256-GCM, so tampering is detected rather than producing a plausible
 * wrong answer. The key is `FIELD_ENC_KEY`, generated once on first run and
 * kept in `.env` beside the database.
 *
 * The consequence of that is worth stating plainly, because it surprises
 * people: **change FIELD_ENC_KEY and everything encrypted with the old one
 * becomes unreadable.** Nothing is lost except the secrets themselves, and the
 * product asks for them again rather than failing, but it does ask.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12; // 96 bits, the size GCM is defined for

/**
 * The 32-byte key.
 *
 * Production is validated at start-up to be 64 hex characters. A development
 * key that is not gets hashed to the right length instead of crashing, because
 * refusing to boot over a short throwaway key helps nobody.
 */
function key(): Buffer {
  const raw = config.FIELD_ENC_KEY;
  return /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : createHash("sha256").update(raw, "utf8").digest();
}

/** True if the value looks like something this module produced. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}:`) && value.split(":").length === 4;
}

/** Encrypts a string. The result is safe to store and safe to back up. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("hex"), tag.toString("hex"), body.toString("hex")].join(":");
}

/**
 * Reverses `encryptSecret`.
 *
 * Throws if the value was written with a different key, or if anything about
 * it has been altered. Callers should treat that as "the secret is gone, ask
 * for it again", not as a reason to stop.
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) {
    throw new Error("Not an encrypted value.");
  }
  const [, ivHex, tagHex, bodyHex] = stored.split(":");
  // The full 16-byte tag, always. GCM accepts shorter ones, and a short tag is
  // far easier to forge.
  const tag = Buffer.from(tagHex!, "hex");
  if (tag.length !== 16) throw new Error("The encrypted value has been altered.");
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivHex!, "hex"), { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(bodyHex!, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Decrypts, or returns null instead of throwing.
 *
 * For the common case: the key was rotated, the old secret cannot be read, and
 * the right response is to behave as though it was never set.
 */
export function tryDecryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch {
    return null;
  }
}
