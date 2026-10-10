import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * No black windows.
 *
 * On Windows the product starts from a shortcut that runs hidden, and starts
 * its own parts from there. A program started by something with no console of
 * its own is given a brand new, visible one - so every spawn on that path has
 * to say `windowsHide: true`, or a black "node.exe" window appears on screen,
 * and closing it stops the product. It happened: the launcher was hidden and
 * the two things it started were not, so every start showed two windows, and
 * it was reported more than once before the cause was found.
 *
 * This reads the source rather than running Windows, so it holds on any
 * machine, and fails the build the moment a new spawn forgets.
 */
const FILES = [
  "../../deploy/windows/runtime/start.js",
  "../../deploy/windows/runtime/open.js",
  "src/updater/windows.ts",
  "src/updater/common.ts",
];

/** The text of each spawn( ... ) call, from its opening bracket to its matching one. */
function spawnCalls(source: string): string[] {
  const calls: string[] = [];
  for (const m of source.matchAll(/\bspawn\(/g)) {
    let depth = 0;
    let i = m.index! + m[0].length - 1;
    const start = i;
    for (; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) break;
    }
    calls.push(source.slice(start, i + 1));
  }
  return calls;
}

describe("Windows: nothing starts with a visible console window", () => {
  for (const file of FILES) {
    it(`${file}: every spawn hides its window`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      const calls = spawnCalls(source);
      expect(calls.length, `${file} no longer starts anything - update this list`).toBeGreaterThan(0);

      const bare = calls.filter((c) => !/windowsHide:\s*true/.test(c));
      expect(
        bare.map((c) => c.replace(/\s+/g, " ").slice(0, 90)),
        "these would draw a black console window on Windows",
      ).toEqual([]);
    });
  }
});
