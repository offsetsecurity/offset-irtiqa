/**
 * Stored files: the evidence somebody actually hands an auditor.
 *
 * Two rules shape all of this.
 *
 * **The name a person typed never becomes part of a path.** A filename is
 * attacker-controlled text. It can contain "../", a drive letter, a NUL, or
 * four hundred characters of Unicode that normalise into something else
 * entirely. Every file here is stored under a random key this module chose, and
 * the original name is kept in the database as a label to show and nothing
 * more.
 *
 * **Nothing is ever served in a way a browser will run.** An uploaded .html or
 * .svg served inline executes on our origin, with the viewer's session, which
 * turns a document store into stored cross-site scripting. Downloads are always
 * an attachment with a generic content type.
 */
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { config } from "../config.js";

export interface StoredFile {
  /** Our name for it. The only thing that ever touches the filesystem. */
  key: string;
  /** What the person called it. A label, never a path. */
  name: string;
  size: number;
  sha256: string;
}

/** Absolute path of the folder holding uploaded files. */
export function evidenceDir(): string {
  return resolve(config.EVIDENCE_DIR);
}

/**
 * Where a key lives on disk.
 *
 * Sharded by the first two characters. A single directory with tens of
 * thousands of entries is slow to list on every filesystem worth naming, and
 * this costs nothing to do now and is painful to retrofit.
 */
export function pathFor(key: string): string {
  return join(evidenceDir(), key.slice(0, 2), key);
}

/** True only for a key this module could have produced. */
export function isValidKey(key: string): boolean {
  return /^[0-9a-f]{32}$/.test(key);
}

/**
 * Trims a filename down to something safe to show and to put in a header.
 *
 * Not used to build a path — nothing here is — but a name with a newline in it
 * would let somebody inject their own HTTP headers on the way out, and one with
 * a NUL breaks tools further down the line.
 */
export function safeFileName(raw: string): string {
  const cleaned = raw
    // Control characters, written as escapes rather than as themselves: the
    // literal range put raw NUL bytes into the source file. CR and LF matter
    // most, because a filename carrying them could inject its own HTTP
    // headers on the way back out.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return cleaned || "attachment";
}

export class UploadTooLarge extends Error {
  constructor(public readonly limitBytes: number) {
    super(`That file is larger than the ${Math.round(limitBytes / 1024 / 1024)} MB limit.`);
  }
}

/**
 * Writes a stream to a new file and returns what to record about it.
 *
 * The size limit is enforced here as the bytes arrive rather than trusted from
 * a header, and a file that exceeds it is deleted rather than left as a
 * half-written stub.
 */
export async function storeFile(
  source: Readable,
  originalName: string,
  limitBytes = config.MAX_UPLOAD_MB * 1024 * 1024,
): Promise<StoredFile> {
  const key = randomBytes(16).toString("hex");
  const destination = pathFor(key);
  await mkdir(dirname(destination), { recursive: true });

  const hash = createHash("sha256");
  let size = 0;
  let tooBig = false;

  const counter = async function* (chunks: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
    for await (const chunk of chunks) {
      size += chunk.length;
      if (size > limitBytes) {
        tooBig = true;
        // Stop reading rather than writing the rest and deleting it after.
        throw new UploadTooLarge(limitBytes);
      }
      hash.update(chunk);
      yield chunk;
    }
  };

  try {
    await pipeline(source, counter, createWriteStream(destination));
  } catch (err) {
    await rm(destination, { force: true }).catch(() => {});
    if (tooBig) throw new UploadTooLarge(limitBytes);
    throw err;
  }

  return { key, name: safeFileName(originalName), size, sha256: hash.digest("hex") };
}

/**
 * The absolute path for a stored key, or null if there is nothing to serve.
 *
 * Refuses a key it could not have written, which is what stops a crafted
 * `file_key` reaching outside the folder.
 */
export async function pathOfStored(key: string | null | undefined): Promise<string | null> {
  if (!key || !isValidKey(key)) return null;
  const path = pathFor(key);
  try {
    const info = await stat(path);
    return info.isFile() ? path : null;
  } catch {
    return null;
  }
}

/** Removes a stored file. Silent when it is already gone. */
export async function deleteStored(key: string | null | undefined): Promise<void> {
  if (!key || !isValidKey(key)) return;
  await rm(pathFor(key), { force: true }).catch(() => {});
}
