import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The plain-English explanation beside every control.
 *
 * Shown on the control's screen in every product. The customer who most needs
 * it is the one who cannot already explain the control, so a control without
 * one is a gap a customer finds, not a nicety. Anchor's 1,014 were written on
 * 2026-09-22; this keeps any product from shipping a control without one.
 */
/**
 * Every pack present on disk, not a written list.
 *
 * This repository holds one product and one pack. Reading the folder rather
 * than naming the pack keeps the check honest if the pack is ever renamed, and
 * the count catches a half-copied checkout.
 */
const PACKS = readdirSync(resolve(process.cwd(), "../../packs"), { withFileTypes: true })
  .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && existsSync(resolve(process.cwd(), "../../packs", d.name, "pack.json")))
  .map((d) => d.name)
  .sort();
if (PACKS.length !== 1) throw new Error(`expected one pack in packs/, found ${PACKS.length}`);
const packFile = (id: string, f: string) => resolve(process.cwd(), "../../packs", id, f);

async function load(id: string) {
  const controls = JSON.parse(await readFile(packFile(id, "controls.json"), "utf8")) as
    | { ref: string }[]
    | { controls: { ref: string }[] };
  const list = Array.isArray(controls) ? controls : controls.controls;
  const guide = JSON.parse(await readFile(packFile(id, "guide.json"), "utf8")) as Record<
    string,
    Record<string, string>
  >;
  return { refs: list.map((c) => c.ref), guide };
}

describe("control explanations", () => {
  for (const id of PACKS) {
    it(`${id}: every control says what it is, and nothing else is listed`, async () => {
      const { refs, guide } = await load(id);
      const missing = refs.filter((r) => !(guide[r]?.["o"] ?? "").trim());
      expect(missing, `${id} controls with no explanation`).toEqual([]);
      expect(Object.keys(guide).filter((k) => !refs.includes(k)), `${id} explains controls it does not have`).toEqual([]);
    });
  }

  // Anchor keeps NIST's own wording in "s" as well. Skipped where that pack
  // is not present, which is every single-product repository but Anchor's.
  const anchor = PACKS.includes("anchor") ? it : it.skip;

  anchor("anchor: what it is, what to do, what an assessor checks, the records, and NIST's words", async () => {
    const { refs, guide } = await load("anchor");
    for (const r of refs) {
      for (const k of ["o", "a", "e", "r", "s"]) {
        expect((guide[r]?.[k] ?? "").trim().length, `${r}.${k}`).toBeGreaterThan(9);
      }
    }
  });

  anchor("anchor: NIST's words read cleanly on screen", async () => {
    const { guide } = await load("anchor");
    const text = JSON.stringify(guide);
    expect(text).not.toContain("[ODP]");
    expect(text).not.toMatch(/\]\(#/);
    // The export repeated many statements twice in a row.
    const repeated = Object.entries(guide).filter(([, v]) => {
      const s = v["s"] ?? "";
      const half = Math.floor(s.length / 2);
      return s.length > 20 && s.slice(0, half).trim() === s.slice(s.length - half).trim();
    });
    expect(repeated.map(([k]) => k)).toEqual([]);
  });
});
