import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Help and Documentation, in every product that switches them on.
 *
 * The pages are plain Markdown in each pack, and most of them started life as
 * a copy of Assure's. The risk with a copy is that it keeps pointing at things
 * the product does not have: a Calendar in Irtiqa, a Statement of
 * Applicability in Anchor. A reader told to open a screen that is not in their
 * menu stops trusting the rest of the page, so that is checked here, not left
 * to a proof-reader.
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
const packDir = (id: string): string => resolve(process.cwd(), "../../packs", id);

interface Page { file: string; title: string; about: string }
interface Index { note: string; help: Page[]; guides: Page[] }

/**
 * Screens and reports that only some products have, as a page would name
 * them in bold, and the feature that puts them in the product.
 */
const GATED_NAMES: Record<string, string> = {
  "Profile & Tiers": "tiers",
  "Applicability": "statementOfApplicability",
  "Statement of Applicability": "statementOfApplicability",
  "System & Baseline": "baselines",
  "Baseline and tailoring": "baselines",
  "Suppliers": "ismsRegisters",
  "Training": "ismsRegisters",
  "Objectives": "ismsRegisters",
  "Interested parties": "ismsRegisters",
  "Audits & reviews": "ismsRegisters",
  "Communications": "ismsRegisters",
  "Management review pack": "ismsRegisters",
  "Gap analysis": "gapAnalysis",
  "Calendar": "calendar",
  "Templates": "policyTemplates",
  "Testing": "controlTesting",
  "Maturity assessment": "maturity",
};

async function features(id: string): Promise<Record<string, boolean>> {
  const pack = JSON.parse(await readFile(resolve(packDir(id), "pack.json"), "utf8")) as {
    features?: Record<string, boolean>;
  };
  return pack.features ?? {};
}

describe("Help and Documentation", () => {
  it("is switched on in every product", async () => {
    for (const id of PACKS) {
      expect((await features(id))["help"], `${id} has no help`).toBe(true);
    }
  });

  for (const id of PACKS) {
    it(`${id}: ships every page it lists, and lists every page it ships`, async () => {
      const dir = resolve(packDir(id), "help");
      const index = JSON.parse(await readFile(resolve(dir, "index.json"), "utf8")) as Index;
      const listed = [...index.help, ...index.guides];
      expect(index.note.length).toBeGreaterThan(20);
      expect(index.help.length).toBeGreaterThanOrEqual(4);
      expect(index.guides.length).toBeGreaterThanOrEqual(5);

      for (const page of listed) {
        expect(page.title.length).toBeGreaterThan(3);
        expect(page.about.length).toBeGreaterThan(15);
        const text = await readFile(resolve(dir, page.file), "utf8");
        expect(text.startsWith("# "), `${id}/${page.file} does not start with a heading`).toBe(true);
        expect(text.length, `${id}/${page.file} is too short to be a guide`).toBeGreaterThan(600);
      }

      const onDisk = (await readdir(dir)).filter((f) => f.endsWith(".md"));
      expect(onDisk.sort()).toEqual(listed.map((p) => p.file).sort());
    });

    it(`${id}: links only to pages that ship`, async () => {
      const dir = resolve(packDir(id), "help");
      const index = JSON.parse(await readFile(resolve(dir, "index.json"), "utf8")) as Index;
      const shipped = new Set([...index.help, ...index.guides].map((p) => p.file));
      const broken: string[] = [];
      for (const file of shipped) {
        const text = await readFile(resolve(dir, file), "utf8");
        for (const [, target] of text.matchAll(/\]\(([a-z0-9][a-z0-9-]*\.md)\)/g)) {
          if (!shipped.has(target!)) broken.push(`${file} -> ${target}`);
        }
      }
      expect(broken).toEqual([]);
    });

    it(`${id}: never sends the reader to a screen the product does not have`, async () => {
      const on = await features(id);
      const dir = resolve(packDir(id), "help");
      const problems: string[] = [];
      for (const file of (await readdir(dir)).filter((f) => f.endsWith(".md"))) {
        const text = await readFile(resolve(dir, file), "utf8");
        for (const [, name] of text.matchAll(/\*\*([^*]+)\*\*/g)) {
          const flag = GATED_NAMES[name!.trim()];
          if (flag && !on[flag]) problems.push(`${file}: **${name}** needs "${flag}"`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});
