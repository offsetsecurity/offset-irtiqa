/**
 * Ordering control references the way a person reads them.
 *
 * Every framework numbers its controls, and SQLite sorts those numbers as
 * text: "3.3.10" lands between "3.3.1" and "3.3.2", and "A.5.37" comes before
 * "A.5.4". On screen that reads as missing controls rather than as a sorting
 * quirk, and in an exported report it is worse, because the reader has no
 * scrollbar to reassure them.
 *
 * Sorting in JavaScript rather than in SQL is deliberate. The rule differs by
 * framework - "3.3.10", "A.5.1", "PR.AC-1", "AC-2(1)" - and expressing it as a
 * SQL expression means either a stored sort key that has to be kept in step
 * with the ref, or an expression that only fits one pack. A control set is at
 * most a few thousand rows, so the cost of sorting them in memory is nothing.
 */

/** Split a ref into digit and non-digit runs: "A.5.10" -> ["A.", "5", ".", "10"]. */
const parts = (ref: string): string[] => ref.match(/\d+|\D+/g) ?? [];

/**
 * Compares two refs so that numbers inside them sort as numbers.
 *
 * Leading zeros are handled by the numeric comparison itself, so "A.05" and
 * "A.5" are ordered together rather than apart. Where two refs are equal apart
 * from that padding, the raw strings break the tie, so the order is total and
 * the sort is stable across runs.
 */
export function compareRefs(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);

  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const p = x[i]!;
    const q = y[i]!;
    const bothNumeric = /^\d/.test(p) && /^\d/.test(q);

    if (bothNumeric) {
      const d = Number(p) - Number(q);
      if (d !== 0) return d;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }

  if (x.length !== y.length) return x.length - y.length;
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * Sorts rows by theme first, then by ref, the way every listing wants them.
 *
 * `order` is the theme list from the pack, which is the framework's own
 * running order rather than the alphabetical order of its keys. A theme
 * missing from that list sorts after the ones in it, by key, so an unknown
 * value ends up somewhere predictable instead of at the front.
 */
export function byThemeThenRef<T extends { theme: string; ref: string }>(
  rows: T[],
  order: string[] = [],
): T[] {
  const rank = new Map(order.map((t, i) => [t, i]));
  const of = (theme: string): number => rank.get(theme) ?? order.length;

  return [...rows].sort(
    (a, b) =>
      of(a.theme) - of(b.theme) ||
      a.theme.localeCompare(b.theme) ||
      compareRefs(a.ref, b.ref),
  );
}
