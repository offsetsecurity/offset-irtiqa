import type { LinkOption } from "./Register.js";

/** The part of the sample library this needs: risks, each naming the controls that treat it. */
export interface SampleRiskGroups {
  risks: { items: Record<string, unknown>[] }[];
}

const STOP = new Set([
  "that", "this", "with", "from", "have", "into", "when", "does", "their", "there", "which", "about", "being",
  "they", "them", "than", "then", "will", "would", "could", "should", "your", "other", "such", "more", "most",
  "only", "also", "were", "been", "before", "after", "where", "while", "without", "because", "every", "much",
]);
const words = (s: string): string[] => (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w));

/**
 * Controls that probably treat a risk, guessed from its title.
 *
 * The sample library holds 111 risks, each with the controls that treat it.
 * The words of a new risk are matched to those, the three closest are taken,
 * and the controls they name are offered, most common first. A suggestion
 * only: nothing is linked until somebody accepts it.
 */
export function suggestControls(
  title: string,
  category: string,
  samples: SampleRiskGroups | null,
  controls: LinkOption[],
): string[] {
  const mine = new Set([...words(title), ...words(category)]);
  if (!samples || mine.size === 0) return [];
  const byRef = new Map(controls.map((c) => [c.label, c.id] as const));
  const scored: { score: number; refs: string[] }[] = [];
  for (const g of samples.risks) {
    for (const it of g.items) {
      const refs = (it["refs"] as string[] | undefined) ?? [];
      if (!refs.length) continue;
      const head = new Set(words(String(it["title"] ?? "")));
      const rest = new Set(words(`${it["description"] ?? ""} ${it["category"] ?? ""}`));
      let score = 0;
      for (const w of mine) score += head.has(w) ? 2 : rest.has(w) ? 1 : 0;
      if (score >= 2) scored.push({ score, refs });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const count = new Map<string, number>();
  for (const s of scored.slice(0, 3)) for (const r of s.refs) count.set(r, (count.get(r) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([ref]) => byRef.get(ref))
    .filter((id): id is string => id !== undefined)
    .slice(0, 6);
}

/** Control ids for the references a sample names, skipping any this product does not have. */
export function idsForRefs(refs: string[] | undefined, controls: LinkOption[]): string[] {
  const byRef = new Map(controls.map((c) => [c.label, c.id] as const));
  return (refs ?? []).map((r) => byRef.get(r)).filter((id): id is string => id !== undefined);
}
