import { describe, it, expect } from "vitest";
import { assertCanWrite } from "../src/auth/rbac.js";
import { HttpError } from "../src/lib/errors.js";
import { validatePasswordStrength } from "../src/auth/password.js";

describe("RBAC", () => {
  it("lets admin and contributor write", () => {
    expect(() => assertCanWrite("admin")).not.toThrow();
    expect(() => assertCanWrite("contributor")).not.toThrow();
  });

  it("refuses writes from auditor and readonly", () => {
    for (const role of ["auditor", "readonly"] as const) {
      expect(() => assertCanWrite(role)).toThrow(HttpError);
      try {
        assertCanWrite(role);
      } catch (err) {
        expect((err as HttpError).statusCode).toBe(403);
      }
    }
  });
});

describe("password policy", () => {
  it("rejects short passwords", () => {
    expect(validatePasswordStrength("short")).toMatch(/at least 12/);
  });

  it("rejects leading or trailing whitespace", () => {
    expect(validatePasswordStrength(" correct horse battery ")).toMatch(/space/);
  });

  it("accepts a reasonable passphrase", () => {
    expect(validatePasswordStrength("correct-horse-battery-staple")).toBeNull();
  });
});
