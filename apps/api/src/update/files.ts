import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseVersion, type InstallKind } from "./release.js";

/**
 * The handoff between the application and an updater.
 *
 * Two folders, and the split between them is the security boundary:
 *
 *   request folder  written by the application, read by the updater
 *   status folder   written by the updater, read by the application
 *
 * The updater runs with far more privilege than the application: root on
 * Linux, SYSTEM on Windows, the Docker socket in a container. So everything it
 * reads from the request folder is treated as hostile - a symlink, a huge
 * file, a version string with a path in it - and it never writes into a folder
 * the application can write to, because a privileged process writing through
 * a link the application planted is how "update the status file" becomes
 * "overwrite /etc/shadow".
 *
 * Like release.ts this imports nothing from the application.
 */

export const REQUEST_FILE = "request.json";
export const STATUS_FILE = "status.json";
export const PRESENCE_FILE = "updater.json";

export type UpdateState =
  | "queued" | "downloading" | "installing" | "verifying" | "done" | "failed" | "rolled_back";

/** What the application asks for. Everything in it is re-checked by the updater. */
export interface UpdateRequest {
  id: string;
  version: string;
  /** File name only, inside the backup folder. Restored if the update is rolled back. */
  backup: string;
  requestedBy: string;
  requestedAt: string;
}

export interface UpdateStatus {
  requestId: string;
  version: string;
  from: string;
  state: UpdateState;
  message: string;
  updatedAt: string;
}

/**
 * Proof that an updater exists for this install.
 *
 * The application only offers the Update button when one does. A Docker
 * updater rewrites this on every poll, so a stale `seenAt` means it has
 * stopped; the Linux and Windows installers write it once.
 */
export interface UpdaterPresence {
  kind: InstallKind;
  installedAt?: string;
  seenAt?: string;
}

const ID = /^[0-9a-f-]{36}$/;
const BACKUP = /^pre-update-[0-9A-Za-z.-]{1,80}\.db$/;

/**
 * Reads a small JSON file, refusing anything that is not a plain file.
 *
 * lstat, not stat: a symlink is refused rather than followed. On Windows a
 * junction reports as a symbolic link too, so the same check covers it.
 */
export async function readSmallJson<T>(path: string, maxBytes = 64 * 1024): Promise<T | null> {
  let info;
  try {
    info = await lstat(path);
  } catch {
    return null;
  }
  if (!info.isFile() || info.size > maxBytes) return null;
  // Checked again on the file actually opened, so swapping it for something
  // else between the check above and the read changes nothing.
  let handle;
  try {
    handle = await open(path, "r");
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maxBytes || opened.ino !== info.ino || opened.dev !== info.dev) return null;
    // The leading byte-order mark PowerShell used to write is stripped:
    // JSON.parse refuses a file that starts with one.
    return JSON.parse((await handle.readFile("utf8")).replace(/^﻿/, "")) as T;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Whether a folder exists as a real folder, not as a link to somewhere else. */
export async function isRealDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Writes JSON so a reader never sees half of it.
 *
 * To a temporary name in the same folder, then renamed over the target, which
 * replaces a planted link rather than writing through it.
 */
export async function writeJsonAtomic(path: string, value: unknown, mode = 0o644): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`);
  const handle = await open(tmp, "wx", mode);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, path);
}

/** Validates a request read from the application's folder. Null means ignore it. */
export function parseRequest(raw: unknown): UpdateRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["id"] !== "string" || !ID.test(r["id"])) return null;
  if (typeof r["version"] !== "string" || !parseVersion(r["version"])) return null;
  if (typeof r["backup"] !== "string" || !BACKUP.test(r["backup"])) return null;
  return {
    id: r["id"],
    version: r["version"],
    backup: r["backup"],
    requestedBy: typeof r["requestedBy"] === "string" ? r["requestedBy"].slice(0, 100) : "",
    requestedAt: typeof r["requestedAt"] === "string" ? r["requestedAt"].slice(0, 40) : "",
  };
}

/** Takes a request out of the application's folder, so it is acted on once. */
export async function takeRequest(folder: string): Promise<UpdateRequest | null> {
  if (!(await isRealDirectory(folder))) return null;
  const path = join(folder, REQUEST_FILE);
  const raw = await readSmallJson<unknown>(path, 4096);
  // Removed whether or not it was valid: a malformed request left in place
  // would be re-read, and refused, every time the updater looks.
  await rm(path, { force: true }).catch(() => undefined);
  return parseRequest(raw);
}

export function newRequestId(): string {
  return randomUUID();
}
