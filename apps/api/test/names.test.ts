import { describe, it, expect } from "vitest";
import { cleanName, personName } from "../src/lib/schema.js";

/**
 * A person's name, as typed into an owner, approver, tester or user name
 * field, is kept as one line of visible text. Line breaks become a space and
 * the invisible characters that hide text or turn it round are taken out, so
 * a name in a list, an email or the audit trail reads as what it is. Names
 * are cleaned, not refused, so a record saved before the rule still saves.
 */
describe("personName", () => {
  const name = personName(200);
  const parse = (t: string) => name.parse(t);

  it("keeps ordinary names in any script, with the marks and joiners real names use", () => {
    for (const ok of [
      "", "Head of IT", "O'Brien-Smith, J.", "Zo\u00EB \u00C5ngstr\u00F6m",
      "\u0639\u0628\u062F\u0627\u0644\u0644\u0647 \u0627\u0644\u0642\u062D\u0637\u0627\u0646\u064A",
      "\u0639\u0628\u062F\u0627\u0644\u0644\u0647\u200F (CISO)", "\u200EAlex \u061C",
      "\u0645\u0647\u0631\u200C\u0622\u0631\u0627", "\u0915\u094D\u200D\u0937", "\u674E\u5C0F\u9F8D",
    ]) {
      expect(parse(ok), JSON.stringify(ok)).toBe(ok);
    }
  });

  it("turns line breaks and tabs into one space", () => {
    expect(parse("Alex\nMorgan")).toBe("Alex Morgan");
    expect(parse("Alex\r\n\r\nMorgan")).toBe("Alex Morgan");
    expect(parse("Alex\tMorgan")).toBe("Alex Morgan");
    expect(parse("Alex\u2028Morgan")).toBe("Alex Morgan");
    expect(parse("Alex\u0085Morgan")).toBe("Alex Morgan");
  });

  it("takes out control characters and the marks that hide text or turn it round", () => {
    for (const [bad, good] of [
      ["Alex\u0000", "Alex"], ["Alex\u0007", "Alex"], ["Alex\u001B[31m", "Alex[31m"], ["Alex\u007F", "Alex"],
      ["\u202Enagrom xela", "nagrom xela"], ["Alex\u202D", "Alex"], ["Alex\u2066x\u2069", "Alexx"],
      ["Al\u200Bex", "Alex"], ["Al\u2060ex", "Alex"], ["\uFEFFAlex", "Alex"], ["Al\u00ADex", "Alex"],
      ["Alex\u{E0041}\u{E0042}", "Alex"], ["  Alex  ", "Alex"],
    ]) {
      expect(parse(bad!), JSON.stringify(bad)).toBe(good);
    }
  });

  it("takes out the variation selectors and the Hangul fillers, which show as nothing", () => {
    for (const [bad, good] of [
      ["Al\uFE00ex", "Alex"], ["Alex\uFE0F", "Alex"],
      ["\u3164", ""], ["Alex \u3164", "Alex"], ["\uFFA0Alex", "Alex"],
      ["Al\u115Fex", "Alex"], ["Al\u1160ex", "Alex"],
    ]) {
      expect(parse(bad!), JSON.stringify(bad)).toBe(good);
    }
    // A user name made only of Hangul fillers is refused: nothing is left of it.
    expect(personName(200, 1).safeParse("\u3164\u3164").success).toBe(false);
    // A Japanese name with an ideographic variant marker (U+E0100 and up) is kept.
    expect(parse("\u8FBB\u{E0100}\u592A\u90CE")).toBe("\u8FBB\u{E0100}\u592A\u90CE");
    // An emoji keeps its picture; only the selector that asks for colour goes.
    expect(parse("Alex \u2764\uFE0F")).toBe("Alex \u2764");
    // Real Hangul is kept.
    expect(parse("\uAE40\uC9C0\uC218")).toBe("\uAE40\uC9C0\uC218");
  });

  it("still limits the length, and a required name must have something left", () => {
    expect(name.safeParse("a".repeat(200)).success).toBe(true);
    expect(name.safeParse("a".repeat(201)).success).toBe(false);
    expect(personName(200, 1).safeParse("\u202E\u200B ").success).toBe(false);
    expect(personName(200, 1).safeParse("Lee").success).toBe(true);
  });

  it("is the same rule the routes use", () => {
    expect(cleanName("a\nb\u202E")).toBe("a b");
  });
});
