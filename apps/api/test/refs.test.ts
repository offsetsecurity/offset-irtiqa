import { describe, it, expect } from "vitest";
import { compareRefs, byThemeThenRef } from "../src/lib/refs.js";

/**
 * Every framework in the catalogue numbers its controls, and every one of them
 * sorts wrongly as plain text. These are the four shapes actually in the packs
 * plus the awkward cases that broke the naive version.
 */
describe("control reference ordering", () => {
  const sorted = (refs: string[]): string[] => [...refs].sort(compareRefs);

  it("puts double figures after single ones", () => {
    // The SAMA shape. Text ordering slots 3.3.10 between 3.3.1 and 3.3.2,
    // which reads on screen as a missing control rather than a sorting quirk.
    expect(sorted(["3.3.10", "3.3.2", "3.3.1", "3.3.17", "3.3.9"])).toEqual([
      "3.3.1", "3.3.2", "3.3.9", "3.3.10", "3.3.17",
    ]);
  });

  it("handles the other three packs", () => {
    // ISO 27001 Annex A.
    expect(sorted(["A.5.37", "A.5.4", "A.8.1", "A.5.10"])).toEqual([
      "A.5.4", "A.5.10", "A.5.37", "A.8.1",
    ]);
    // NIST CSF 2.0 subcategories.
    expect(sorted(["PR.AC-11", "PR.AC-2", "ID.AM-1", "PR.AA-1"])).toEqual([
      "ID.AM-1", "PR.AA-1", "PR.AC-2", "PR.AC-11",
    ]);
    // SP 800-53 controls with enhancements.
    expect(sorted(["AC-2(10)", "AC-2(1)", "AC-10", "AC-2"])).toEqual([
      "AC-2", "AC-2(1)", "AC-2(10)", "AC-10",
    ]);
  });

  it("orders padded and unpadded numbers together", () => {
    // "A.05" and "A.5" are the same control written two ways. They must not
    // end up at opposite ends of the list.
    expect(sorted(["A.5.2", "A.05.1", "A.5.1"])).toEqual(["A.05.1", "A.5.1", "A.5.2"]);
  });

  it("is a total order, so the sort is stable", () => {
    // Equal-but-for-padding refs still have to break their tie the same way
    // every run, or the list reshuffles itself between page loads.
    expect(compareRefs("A.05", "A.5")).toBeLessThan(0);
    expect(compareRefs("A.5", "A.05")).toBeGreaterThan(0);
    expect(compareRefs("A.5", "A.5")).toBe(0);
  });

  it("copes with refs that are not numbered at all", () => {
    expect(sorted(["Governance", "Access", "1.1"])).toEqual(["1.1", "Access", "Governance"]);
  });

  it("groups by theme before ordering within it", () => {
    const rows = [
      { theme: "OT", ref: "3.3.10" },
      { theme: "LG", ref: "3.1.2" },
      { theme: "OT", ref: "3.3.2" },
      { theme: "LG", ref: "3.1.10" },
    ];
    expect(byThemeThenRef(rows).map((r) => `${r.theme} ${r.ref}`)).toEqual([
      "LG 3.1.2", "LG 3.1.10", "OT 3.3.2", "OT 3.3.10",
    ]);
    // And it leaves the caller's array alone.
    expect(rows[0]!.ref).toBe("3.3.10");
  });

  it("follows the framework's running order, not the alphabet", () => {
    // SAMA runs 3.1 Leadership, 3.2 Risk, 3.3 Operations, 3.4 Third party.
    // Sorted by key that comes out LG, OT, RC, TP, which is the wrong order to
    // read a report in.
    const rows = [
      { theme: "TP", ref: "3.4.1" },
      { theme: "OT", ref: "3.3.1" },
      { theme: "LG", ref: "3.1.1" },
      { theme: "RC", ref: "3.2.1" },
    ];
    const order = ["LG", "RC", "OT", "TP"];
    expect(byThemeThenRef(rows, order).map((r) => r.theme)).toEqual(["LG", "RC", "OT", "TP"]);
  });

  it("puts a theme the pack does not list at the end", () => {
    const rows = [
      { theme: "XX", ref: "9.1" },
      { theme: "RC", ref: "3.2.1" },
      { theme: "LG", ref: "3.1.1" },
    ];
    expect(byThemeThenRef(rows, ["LG", "RC"]).map((r) => r.theme)).toEqual(["LG", "RC", "XX"]);
  });
});
