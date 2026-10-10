import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The sample asset and risk library.
 *
 * This is content rather than code, so nothing here tests behaviour. It tests
 * the two ways content rots: a reference that points at a control which no
 * longer exists, and a gap where a whole subdomain has nothing against it.
 *
 * Both are invisible on screen. A dangling reference renders as a perfectly
 * ordinary "covers 1.8.3" chip, and a subdomain with no sample risk simply
 * looks like a shorter list.
 */

const PACKS = resolve(process.cwd(), "../../packs");

interface Item {
  name?: string;
  type?: string;
  category?: string;
  criticality?: string;
  classification?: string;
  treatment?: string;
  title?: string;
  description?: string;
  likelihood?: number;
  impact?: number;
  refs?: string[];
}
interface Group { id: string; name: string; items: Item[] }
interface Samples { note: string; assets: Group[]; risks: Group[] }
interface Control { ref: string; title: string; parentRef?: string }

/** The packs that ship a library. Every one of them is held to the same rules. */
// Whatever packs this repository holds.
const sampleIds = readdirSync(resolve(process.cwd(), "../../packs"), { withFileTypes: true })
  .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && existsSync(resolve(process.cwd(), "../../packs", d.name, "samples.json")))
  .map((d) => d.name);

for (const id of sampleIds) {
  const read = async <T>(file: string): Promise<T> =>
    JSON.parse(await readFile(resolve(PACKS, id, file), "utf8")) as T;

  describe(`sample library: ${id}`, () => {
    it("offers enough to be worth opening", async () => {
      const s = await read<Samples>("samples.json");
      const assets = s.assets.flatMap((g) => g.items);
      const risks = s.risks.flatMap((g) => g.items);

      // A handful of samples is worse than none: it looks like the feature was
      // abandoned half way.
      expect(assets.length).toBeGreaterThanOrEqual(80);
      expect(risks.length).toBeGreaterThanOrEqual(40);
      expect(s.note.length).toBeGreaterThan(40);
    });

    it("points only at controls that exist", async () => {
      const [samples, controls] = await Promise.all([
        read<Samples>("samples.json"),
        read<Control[]>("controls.json"),
      ]);
      const known = new Set(controls.map((c) => c.ref));

      const dangling: string[] = [];
      for (const group of [...samples.assets, ...samples.risks]) {
        for (const item of group.items) {
          for (const ref of item.refs ?? []) {
            if (!known.has(ref)) dangling.push(`${item.name ?? item.title} -> ${ref}`);
          }
        }
      }
      expect(dangling, "sample references a control that does not exist").toEqual([]);
    });

    /**
     * Every subdomain needs at least one sample risk, because the gaps are what
     * a customer will not think of themselves - that is the whole point of
     * shipping a library rather than an empty register.
     *
     * What counts as a subdomain differs by framework, so each pack is held to
     * the smallest grouping that is fair to ask for: SAMA has subdomains above
     * its controls; ISO 27001 Annex A is flat and short, so every control gets
     * a risk; SP 800-53 is flat and a thousand long, so its 20 families do.
     */
    it("leaves no subdomain without a sample risk", async () => {
      const [samples, controls] = await Promise.all([
        read<Samples>("samples.json"),
        read<Control[]>("controls.json"),
      ]);

      const nested = controls.some((c) => c.parentRef);
      const byFamily = controls.length > 200;
      // A nested control counts towards the subdomain or standard it sits under.
      // Read from the pack rather than from the shape of the number: SAMA's
      // subdomains are three parts deep ("3.1.1"), HIPAA's are not dotted at all.
      const parentOf = new Map(controls.map((c) => [c.ref, c.parentRef ?? null]));
      const group = (ref: string): string =>
        byFamily ? ref.split("-")[0]! : nested ? (parentOf.get(ref) ?? ref) : ref;

      const wanted = byFamily
        ? [...new Set(controls.map((c) => group(c.ref)))]
        : controls.filter((c) => !c.parentRef).map((c) => c.ref);
      const covered = new Set(
        samples.risks.flatMap((g) => g.items).flatMap((r) => r.refs ?? []).map(group),
      );

      const bare = wanted.filter((s) => !covered.has(s));
      expect(bare, "nothing in the framework has a sample risk against it").toEqual([]);
    });

    it("gives every risk a description and a score to argue with", async () => {
      const s = await read<Samples>("samples.json");
      for (const risk of s.risks.flatMap((g) => g.items)) {
        expect(risk.title, "risk without a title").toBeTruthy();
        expect((risk.description ?? "").length, `${risk.title} has no description`)
          .toBeGreaterThan(40);
        expect(risk.likelihood).toBeGreaterThanOrEqual(1);
        expect(risk.likelihood).toBeLessThanOrEqual(5);
        expect(risk.impact).toBeGreaterThanOrEqual(1);
        expect(risk.impact).toBeLessThanOrEqual(5);
        expect(risk.refs?.length, `${risk.title} points at no control`).toBeGreaterThan(0);
      }
    });

    /**
     * Primary assets are the information and the business processes; the
     * supporting assets are what holds and carries them. The library used to
     * import every one of them as supporting, including the processes.
     */
    it("says whether each sample asset is primary or supporting", async () => {
      const s = await read<Samples>("samples.json");
      const assets = s.assets.flatMap((g) => g.items);

      const PRIMARY = ["Data / Information", "Information Asset", "Business Process",
        "Record", "Document", "Process"];
      const unstated = assets.filter((a) => !a.category).map((a) => a.name);
      expect(unstated, "sample asset with no category").toEqual([]);

      const odd = assets
        .filter((a) => a.category !== "Primary asset" && a.category !== "Supporting asset")
        .map((a) => `${a.name} -> ${a.category}`);
      expect(odd, "a category the register does not offer").toEqual([]);

      const mislabelled = assets
        .filter((a) => PRIMARY.includes(a.type ?? "") && a.category !== "Primary asset")
        .map((a) => a.name);
      expect(mislabelled, "information or a process filed as supporting").toEqual([]);
    });

    /** An asset that links to nothing teaches the reader nothing. */
    it("points every sample asset at a control", async () => {
      const s = await read<Samples>("samples.json");
      const bare = s.assets.flatMap((g) => g.items)
        .filter((a) => !(a.refs ?? []).length)
        .map((a) => a.name);
      expect(bare, "sample asset that points at no control").toEqual([]);
    });

    /**
     * A sample the API will not accept is worse than no sample at all: Add
     * answers 400 and the screen says nothing, so the library looks broken
     * for no visible reason. Abide shipped forty assets classified "ePHI",
     * which the register does not offer, and not one of them could be added.
     */
    it("uses only values the register accepts", async () => {
      const s = await read<Samples>("samples.json");
      const CRITICALITY = ["High", "Medium", "Low"];
      const CLASSIFICATION = ["Public", "Internal", "Confidential", "Restricted"];
      const TREATMENT = ["Mitigate", "Accept", "Transfer", "Avoid"];

      const wrong: string[] = [];
      for (const a of s.assets.flatMap((g) => g.items)) {
        if (!CRITICALITY.includes(a.criticality ?? "")) wrong.push(`${a.name}: criticality ${a.criticality}`);
        if (!CLASSIFICATION.includes(a.classification ?? "")) wrong.push(`${a.name}: classification ${a.classification}`);
      }
      for (const r of s.risks.flatMap((g) => g.items)) {
        if (!TREATMENT.includes(r.treatment ?? "")) wrong.push(`${r.title}: treatment ${r.treatment}`);
      }
      expect(wrong, "a sample the API would refuse").toEqual([]);
    });

    it("names no duplicate asset or risk", async () => {
      const s = await read<Samples>("samples.json");
      for (const [kind, groups] of [["asset", s.assets], ["risk", s.risks]] as const) {
        const names = groups.flatMap((g) => g.items).map((i) => (i.name ?? i.title)!.toLowerCase());
        const seen = new Set<string>();
        const dupes = names.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
        expect(dupes, `duplicate ${kind}`).toEqual([]);
      }
    });
  });
}
