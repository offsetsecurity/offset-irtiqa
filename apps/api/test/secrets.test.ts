import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, isEncrypted, tryDecryptSecret } from "../src/lib/secrets.js";

/**
 * Field encryption.
 *
 * The SMTP password is the first secret this product stores and reads back,
 * and it ends up in every backup anyone takes. The tests that matter are the
 * ones about what happens when something is wrong: a tampered value must be
 * refused rather than decrypted into plausible nonsense, and a rotated key
 * must lose the secret rather than take the product down.
 */
describe("field encryption", () => {
  it("returns what went in", () => {
    const secret = "correct horse battery staple";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("never stores the plain text", () => {
    const sealed = encryptSecret("hunter2-hunter2");
    expect(sealed).not.toContain("hunter2");
    expect(sealed.startsWith("v1:")).toBe(true);
  });

  it("produces a different value every time", () => {
    // A fixed IV would let anyone holding two backups see that the password
    // had not changed between them.
    const a = encryptSecret("same input");
    const b = encryptSecret("same input");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("handles an empty string and non-ASCII text", () => {
    for (const value of ["", "pässwörd", "密码", "a".repeat(1000)]) {
      expect(decryptSecret(encryptSecret(value))).toBe(value);
    }
  });

  it("refuses a value whose body has been altered", () => {
    const sealed = encryptSecret("original");
    const [v, iv, tag, body] = sealed.split(":");
    const flipped = (body!.startsWith("a") ? "b" : "a") + body!.slice(1);
    expect(() => decryptSecret([v, iv, tag, flipped].join(":"))).toThrow();
  });

  it("refuses a value whose authentication tag has been altered", () => {
    const sealed = encryptSecret("original");
    const [v, iv, tag, body] = sealed.split(":");
    const flipped = (tag!.startsWith("a") ? "b" : "a") + tag!.slice(1);
    expect(() => decryptSecret([v, iv, flipped, body].join(":"))).toThrow();
  });

  it("refuses something that was never encrypted", () => {
    for (const value of ["", "plain text", "v1:only:three", "v2:a:b:c"]) {
      expect(isEncrypted(value) && value.startsWith("v1:")).toBe(false);
      expect(() => decryptSecret(value)).toThrow();
    }
  });

  it("treats an unreadable secret as absent rather than fatal", () => {
    // This is what a rotated FIELD_ENC_KEY looks like from the inside. The
    // product must ask for the password again, not refuse to start.
    expect(tryDecryptSecret("v1:00:00:00")).toBeNull();
    expect(tryDecryptSecret("")).toBeNull();
    expect(tryDecryptSecret(null)).toBeNull();
    expect(tryDecryptSecret(undefined)).toBeNull();
    expect(tryDecryptSecret(encryptSecret("readable"))).toBe("readable");
  });

  it("refuses a value whose tamper check has been shortened", () => {
    const [prefix, iv, tag, body] = encryptSecret("smtp-password").split(":");
    const shortened = [prefix, iv, tag!.slice(0, 8), body].join(":");
    expect(() => decryptSecret(shortened)).toThrow();
    expect(tryDecryptSecret(shortened)).toBeNull();
  });
});
