import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The framework pack ships as JSON next to the app. In the container it is at
 * /app/pack; in development it is packs/<product>/ in the repo.
 */
export function packDir(): string {
  const fromEnv = process.env["PACK_DIR"];
  if (fromEnv) return fromEnv;
  const beside = resolve(here, "../../pack");
  if (existsSync(beside)) return beside;
  return resolve(here, "../../../../packs", config.PRODUCT);
}

/** Reads one file from the pack. Throws if the product does not ship it. */
export async function readPack<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(join(packDir(), file), "utf8")) as T;
}

export interface PackMeta {
  id: string;
  product: string;
  framework: string;
  frameworkShort: string;
  themeLabel: string;
  itemLabel: string;
  /** Empty unless there is ever more than one edition to tell apart. */
  edition: string;
  /** Shown in the sidebar and on every page of every report. */
  disclaimer: string;
  /** Where a reader is told to write. Same address for all three products. */
  contact: string;
  features?: Record<string, boolean>;
}

/**
 * pack.json. Deliberately not cached: it is read on rare operations only, and
 * a cache would freeze PACK_DIR at whatever the first caller happened to set.
 */
export async function packMeta(): Promise<PackMeta> {
  return readPack<PackMeta>("pack.json");
}

export async function hasFeature(name: string): Promise<boolean> {
  return Boolean((await packMeta()).features?.[name]);
}

/**
 * The themes in the order the pack lists them.
 *
 * That order is the framework's own - SAMA runs 3.1 Leadership, 3.2 Risk, 3.3
 * Operations, 3.4 Third party - and it is not the alphabetical order of the
 * keys, which would give LG, OT, RC, TP. Reports group by theme, so they have
 * to follow the document rather than the dictionary.
 *
 * A pack without themes.json gets an empty list, and callers fall back to
 * sorting the keys, which is what they did before this existed.
 */
export async function themeOrder(): Promise<string[]> {
  try {
    return Object.keys(await readPack<Record<string, string>>("themes.json"));
  } catch {
    return [];
  }
}
