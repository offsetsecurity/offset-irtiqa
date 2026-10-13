import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config, product } from "../config.js";
import { databasePath, db } from "../db/pool.js";
import { migrate } from "../db/migrate.js";
import { evidenceDir, isValidKey, pathFor } from "../lib/files.js";
import { APP_VERSION } from "../version.js";

/**
 * Backups people can take, keep, download and restore from the screen.
 *
 * A backup is one SQLite file: an online copy of the database, with every
 * evidence document the database points at stored inside it, each under its
 * SHA-256. One file because a backup that is two things - a database here, a
 * folder of documents there - gets half-copied, and a database restored
 * without its documents is a register of evidence that is no longer there.
 * SQLite because it is already the format, it checks itself, and any SQLite
 * tool can open it.
 *
 * Restoring is the most destructive thing the product can do, so it checks
 * the file before touching anything, takes a backup of the present first, and
 * stops the application answering while it swaps. See restoreBackup.
 */

const META_TABLE = "offset_backup_meta";
const FILES_TABLE = "offset_backup_files";

export type BackupKind = "nightly" | "manual" | "pre-restore" | "pre-update" | "uploaded";

const PREFIX: Record<BackupKind, string> = {
  nightly: "offset",
  manual: "manual",
  "pre-restore": "pre-restore",
  "pre-update": "pre-update",
  uploaded: "uploaded",
};

/** Every name a backup can have. Nothing else in the folder is ever listed, served or restored. */
const NAME = /^(offset|manual|pre-restore|pre-update|uploaded)-[0-9A-Za-z.-]{1,80}\.db$/;

export interface BackupMeta {
  format: 1;
  product: string;
  productName: string;
  version: string;
  createdAt: string;
  kind: BackupKind;
  evidenceFiles: number;
  evidenceMissing: number;
}

export interface BackupInfo {
  name: string;
  kind: BackupKind;
  size: number;
  createdAt: string;
  /** False for database-only copies: the ones taken before an update, and any from before this existed. */
  includesEvidence: boolean;
  evidenceFiles: number;
  version: string | null;
}

export class BackupError extends Error {}

const refuse = (message: string): never => {
  throw new BackupError(message);
};

export const backupDir = (): string => resolve(config.BACKUP_DIR);

const stamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

function kindOf(name: string): BackupKind {
  const prefix = name.split("-")[0] === "pre" ? name.split("-").slice(0, 2).join("-") : name.split("-")[0];
  return (Object.entries(PREFIX).find(([, p]) => p === prefix)?.[0] ?? "nightly") as BackupKind;
}

/** The full path of a backup, but only for a name that could be one, and only inside the folder. */
export async function backupPath(name: string): Promise<string> {
  if (!NAME.test(name)) refuse("That is not the name of a backup.");
  const path = join(backupDir(), name);
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile()) refuse("There is no backup with that name.");
  return path;
}

// ── taking one ───────────────────────────────────────────────────────────────

/**
 * Takes a backup of the database and every evidence document it refers to.
 *
 * The database copy uses SQLite's online backup, so people can keep working.
 * Documents are read after it, so one uploaded in between is simply not in
 * this backup; one deleted in between is counted as missing, and said so.
 */
export async function createBackup(kind: Exclude<BackupKind, "pre-update" | "uploaded">): Promise<BackupInfo> {
  const dir = backupDir();
  await mkdir(dir, { recursive: true });
  const name = `${PREFIX[kind]}-${stamp()}.db`;
  const partial = join(dir, `.${name}.partial`);

  await rm(partial, { force: true });
  await db.backup(partial);

  const out = new Database(partial);
  let files = 0;
  let missing = 0;
  try {
    out.exec(`
      create table ${META_TABLE} (id integer primary key check (id = 1), json text not null);
      create table ${FILES_TABLE} (key text primary key, sha256 text not null, size integer not null, data blob not null);
    `);
    const keys = out
      .prepare("select distinct file_key as key from evidence where file_key is not null union select file_key from attachments")
      .all() as { key: string }[];
    const insert = out.prepare(`insert into ${FILES_TABLE} (key, sha256, size, data) values (?, ?, ?, ?)`);

    for (const { key } of keys) {
      if (!isValidKey(key)) continue;
      let data: Buffer;
      try {
        data = await readFile(pathFor(key));
      } catch {
        missing++;
        continue;
      }
      insert.run(key, createHash("sha256").update(data).digest("hex"), data.length, data);
      files++;
    }

    const meta: BackupMeta = {
      format: 1,
      product: config.PRODUCT,
      productName: product.name,
      version: APP_VERSION,
      createdAt: new Date().toISOString(),
      kind,
      evidenceFiles: files,
      evidenceMissing: missing,
    };
    out.prepare(`insert into ${META_TABLE} (id, json) values (1, ?)`).run(JSON.stringify(meta));
    // A backup is read far more rarely than it is kept; make it small.
    out.pragma("journal_mode = DELETE");
    out.exec("VACUUM");
  } finally {
    out.close();
  }

  const final = join(dir, name);
  await rename(partial, final);
  return describe(name);
}

// ── listing ──────────────────────────────────────────────────────────────────

function readMeta(file: SqliteDatabase): BackupMeta | null {
  const has = file.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(META_TABLE);
  if (!has) return null;
  try {
    const row = file.prepare(`select json from ${META_TABLE} where id = 1`).get() as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as BackupMeta) : null;
  } catch {
    return null;
  }
}

async function describe(name: string): Promise<BackupInfo> {
  const path = join(backupDir(), name);
  const info = await stat(path);
  let meta: BackupMeta | null = null;
  try {
    const file = new Database(path, { readonly: true, fileMustExist: true });
    try {
      meta = readMeta(file);
    } finally {
      file.close();
    }
  } catch {
    /* unreadable: listed, and refused if anyone tries to restore it */
  }
  return {
    name,
    kind: kindOf(name),
    size: info.size,
    createdAt: meta?.createdAt ?? info.mtime.toISOString(),
    includesEvidence: Boolean(meta),
    evidenceFiles: meta?.evidenceFiles ?? 0,
    version: meta?.version ?? null,
  };
}

export async function listBackups(): Promise<BackupInfo[]> {
  const dir = backupDir();
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: BackupInfo[] = [];
  for (const name of names.filter((n) => NAME.test(n))) {
    const info = await lstat(join(dir, name)).catch(() => null);
    if (info?.isFile()) out.push(await describe(name));
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── checking one ─────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

/**
 * Everything that must be true of a file before it may replace the data.
 *
 * Returns the reason in words when it is not. Checked again at the moment of
 * restoring, not only when a file is uploaded, because the folder can change
 * in between.
 */
export async function inspectBackup(path: string): Promise<BackupMeta | null> {
  let file: SqliteDatabase | undefined;
  try {
    file = new Database(path, { readonly: true, fileMustExist: true });
    file.prepare("select count(*) from sqlite_master").get();
  } catch {
    // Closed before refusing. SQLite opens a file that is not a database
    // without complaint and only fails at the first read, and a handle left
    // open is one Windows will not let the upload be deleted through.
    try {
      file?.close();
    } catch {
      /* never opened */
    }
    return refuse("That file is not an Offset backup.");
  }

  try {
    const check = file.pragma("quick_check", { simple: true });
    if (check !== "ok") refuse("That backup is damaged, so it has not been used.");

    const tables = new Set(
      (file.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((t) => t.name),
    );
    for (const t of ["users", "controls", "evidence", "settings", "schema_migrations"]) {
      if (!tables.has(t)) refuse("That file is not an Offset backup.");
    }

    // A backup made by a newer version has tables this version does not
    // understand, and a migration history it cannot continue.
    const known = new Set((await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")));
    const applied = (file.prepare("select name from schema_migrations").all() as { name: string }[]).map((r) => r.name);
    if (applied.some((n) => !known.has(n))) {
      refuse("That backup was made by a newer version of Offset. Update this server first, then restore it.");
    }

    // The right product. A backup from another framework would put the wrong
    // controls under this product's name.
    const meta = readMeta(file);
    if (meta && meta.product !== config.PRODUCT) {
      refuse(`That backup is from ${meta.productName}, not ${product.name}.`);
    }
    if (!meta) {
      const theirs = (file.prepare("select ref from controls").all() as { ref: string }[]).map((r) => r.ref);
      const ours = new Set((db.prepare("select ref from controls").all() as { ref: string }[]).map((r) => r.ref));
      const matching = theirs.filter((r) => ours.has(r)).length;
      if (theirs.length === 0 || matching / theirs.length < 0.9) {
        refuse(`That backup is not from ${product.name}.`);
      }
    }

    // Somebody must be able to sign in afterwards, or the restore locks
    // everyone out of their own system.
    const admins = file
      .prepare("select count(*) as n from users where role = 'admin' and disabled = 0")
      .get() as { n: number };
    if (!admins.n) refuse("Nobody could sign in as an administrator after restoring that backup, so it has not been used.");

    if (tables.has(FILES_TABLE)) {
      const rows = file.prepare(`select key, sha256, data from ${FILES_TABLE}`).iterate() as Iterable<{
        key: string; sha256: string; data: Buffer;
      }>;
      for (const row of rows) {
        if (!isValidKey(row.key) || createHash("sha256").update(row.data).digest("hex") !== row.sha256) {
          refuse("An evidence document inside that backup is damaged, so it has not been used.");
        }
      }
    }
    return meta;
  } finally {
    file.close();
  }
}

// ── restoring ────────────────────────────────────────────────────────────────

let restoring = false;

/** True while a restore is swapping the data. The application answers nothing else meanwhile. */
export const restoreInProgress = (): boolean => restoring;

export interface RestoreResult {
  restored: string;
  safetyBackup: string;
  evidenceFiles: number;
}

/**
 * Replaces the data with a backup.
 *
 *  1. Check the file (inspectBackup). Nothing changes if it fails.
 *  2. Back up the present, so this can be undone by restoring that.
 *  3. Stop answering requests, so nothing is written halfway through.
 *  4. Copy the backup's database over the live one with SQLite's backup API,
 *     from a copy with the documents taken out, then bring its schema up to
 *     date - an older backup is restored and then migrated forward.
 *  5. Put the documents back, and remove any the restored database no longer
 *     refers to.
 *  6. End every session: accounts are now as they were in the backup.
 */
export async function restoreBackup(name: string): Promise<RestoreResult> {
  if (restoring) refuse("A restore is already in progress.");
  const source = await backupPath(name);
  await inspectBackup(source);

  const safety = await createBackup("pre-restore");

  restoring = true;
  const dir = backupDir();
  const working = join(dir, `.restore-${stamp()}.db`);
  try {
    // A private copy to take the documents out of, so the live database never
    // holds them.
    const original = new Database(source, { readonly: true, fileMustExist: true });
    try {
      await original.backup(working);
    } finally {
      original.close();
    }

    const copy = new Database(working);
    const documents: { key: string; data: Buffer }[] = [];
    try {
      const hasFiles = copy.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(FILES_TABLE);
      if (hasFiles) {
        for (const row of copy.prepare(`select key, sha256, data from ${FILES_TABLE}`).iterate() as Iterable<{
          key: string; sha256: string; data: Buffer;
        }>) {
          if (isValidKey(row.key) && createHash("sha256").update(row.data).digest("hex") === row.sha256) {
            documents.push({ key: row.key, data: Buffer.from(row.data) });
          }
        }
      }
      copy.exec(`drop table if exists ${FILES_TABLE}; drop table if exists ${META_TABLE};`);
      copy.pragma("journal_mode = DELETE");
      copy.exec("VACUUM");
    } finally {
      copy.close();
    }

    // The swap. The backup API writes into the live file through SQLite's own
    // locking, so the worker, which has the same file open, sees the new data
    // rather than a file changed underneath it.
    const stripped = new Database(working, { readonly: true, fileMustExist: true });
    try {
      await stripped.backup(databasePath);
    } finally {
      stripped.close();
    }
    await migrate();

    // Documents: write each one, then remove those nothing refers to any more.
    // Anything removed is in the safety backup taken above.
    for (const doc of documents) {
      const path = pathFor(doc.key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.restoring`, doc.data);
      await rename(`${path}.restoring`, path);
    }
    const referenced = new Set(
      (db.prepare("select file_key from evidence where file_key is not null union select file_key from attachments").all() as { file_key: string }[])
        .map((r) => r.file_key),
    );
    for (const shard of await readdir(evidenceDir()).catch(() => [] as string[])) {
      if (!/^[0-9a-f]{2}$/.test(shard)) continue;
      for (const key of await readdir(join(evidenceDir(), shard)).catch(() => [] as string[])) {
        if (isValidKey(key) && !referenced.has(key)) await rm(join(evidenceDir(), shard, key), { force: true });
      }
    }

    db.prepare("delete from sessions").run();
    // The safety copy is what undoes this restore, so it stays whatever the
    // limit says; so does the backup just restored, until the next one is taken.
    await pruneBackups([safety.name, name]);
    return { restored: name, safetyBackup: safety.name, evidenceFiles: documents.length };
  } finally {
    await rm(working, { force: true }).catch(() => undefined);
    restoring = false;
  }
}

// ── uploads and deletion ─────────────────────────────────────────────────────

/** Accepts a file that has been written to `partial`, if it is a backup this server can restore. */
export async function acceptUpload(partial: string): Promise<BackupInfo> {
  try {
    await inspectBackup(partial);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  }
  const name = `uploaded-${stamp()}.db`;
  await rename(partial, join(backupDir(), name));
  return describe(name);
}

export async function deleteBackup(name: string): Promise<void> {
  await rm(await backupPath(name), { force: true });
}

// ── keeping only the newest ──────────────────────────────────────────────────

/**
 * Deletes all but the newest BACKUP_KEEP backups, of every kind, and returns
 * the names it removed.
 *
 * Every kind counts, not only the nightly ones, so the folder never holds more
 * than the setting says: a backup taken by hand or before an update is a full
 * copy too, and would otherwise sit there until somebody remembered it.
 *
 * Newest by when the file arrived in the folder, not by the date recorded
 * inside it, so a backup uploaded to be restored counts as new even when it
 * was taken months ago. Names in `protect` are never deleted: the one just
 * taken, and the ones a restore is using.
 */
export async function pruneBackups(protect: readonly string[] = []): Promise<string[]> {
  const dir = backupDir();
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => NAME.test(n));
  const dated: { name: string; at: number }[] = [];
  for (const name of names) {
    const info = await lstat(join(dir, name)).catch(() => null);
    if (info?.isFile()) dated.push({ name, at: info.mtimeMs });
  }
  dated.sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
  const stale = dated
    .slice(config.BACKUP_KEEP)
    .map((d) => d.name)
    .filter((name) => !protect.includes(name));
  for (const name of stale) {
    // SQLite leaves -wal and -shm files beside a copy it has opened to read;
    // they go with it.
    for (const suffix of ["", "-wal", "-shm"]) {
      await rm(join(dir, name + suffix), { force: true }).catch(() => {
        /* in use: it goes next time */
      });
    }
  }
  return stale;
}
