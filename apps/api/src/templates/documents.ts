import { existsSync } from "node:fs";
import { join } from "node:path";
import { packDir } from "../lib/pack.js";
import { writeZip, type ZipEntry } from "../lib/zip.js";
import { fillDocx, fillXlsx } from "./fill.js";
import {
  answersFor, loadKnown, loadManifest, loadStored, readTemplate,
  type Manifest, type ManifestDoc, type Stored, type Known,
} from "./answers.js";

/**
 * A filled template: the pack's file with the customer's answers and
 * register data put in. Made on request and never stored, so it always
 * matches the screens it was made from.
 */

export interface Filled {
  file: string;
  data: Buffer;
  /** Blanks still yellow, and how many the template had. */
  left: number;
  total: number;
}

export interface Loaded {
  manifest: Manifest;
  stored: Stored;
  known: Known;
}

/** Everything a fill needs, read once. Null when the pack's templates cannot be filled. */
export async function load(): Promise<Loaded | null> {
  const manifest = await loadManifest();
  if (!manifest) return null;
  const stored = await loadStored();
  const docLocation = stored.values["doc_location"] ?? "";
  return { manifest, stored, known: await loadKnown(docLocation) };
}

const available = (doc: ManifestDoc): boolean => existsSync(join(packDir(), "templates", doc.file));

export async function fillOne(doc: ManifestDoc, l: Loaded): Promise<Filled> {
  const answers = answersFor(doc, l.manifest, l.stored, l.known);
  const template = await readTemplate(doc.file);
  if (doc.sheet) {
    const cells: Record<string, string> = {};
    for (const [ref, key] of Object.entries(doc.sheet.cells)) cells[ref] = answers.value(key) ?? "";
    let total = Object.keys(doc.sheet.cells).length;
    let left = Object.values(cells).filter((v) => !v.trim()).length;
    for (const [ctrl, row] of Object.entries(doc.sheet.rows)) {
      const values = l.known.soa.get(ctrl) ?? {};
      for (const [field, col] of Object.entries(doc.sheet.columns)) {
        const v = values[field] ?? "";
        cells[`${col}${row}`] = v;
        total++;
        if (!v.trim()) left++;
      }
    }
    return { file: doc.file, data: fillXlsx(template, { path: doc.sheet.path, cells }), left, total };
  }
  const { file, left, total } = fillDocx(template, answers);
  return { file: doc.file, data: file, left, total };
}

/** Every document the pack can fill, in order. */
export async function fillAll(l: Loaded): Promise<Filled[]> {
  const out: Filled[] = [];
  for (const doc of l.manifest.documents) if (available(doc)) out.push(await fillOne(doc, l));
  return out;
}

export function zipOf(files: Filled[]): Buffer {
  return writeZip(files.map((f): ZipEntry => ({ name: f.file, data: f.data })));
}

export const CONTENT_TYPE: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
