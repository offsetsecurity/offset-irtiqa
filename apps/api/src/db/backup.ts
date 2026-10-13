import { copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pool } from "./pool.js";
import { backupDir, createBackup } from "../backup/service.js";

/**
 * A full backup from the command line: the database and every evidence
 * document in one file, exactly as "Take a backup now" on the Backups screen.
 *
 *   pnpm backup                        -> <BACKUP_DIR>/manual-<timestamp>.db
 *   pnpm backup /path/to/copy.db       -> the same, and a copy there
 *
 * Safe to run while the application is serving traffic: better-sqlite3 uses
 * SQLite's online backup API, which copies page by page and restarts if a
 * writer changes the file underneath it.
 *
 * It always lands in BACKUP_DIR, the same setting the nightly job uses, so it
 * shows in the Backups list and can be restored from there. It used to be a
 * literal "./backups", which quietly meant somewhere different depending on
 * where the process was started from: in the container the working directory
 * is the application folder, so a backup taken by hand landed inside the
 * container rather than on the volume and died with it. A backup that reports
 * success and is not there afterwards is worse than no backup at all.
 */
const started = Date.now();

createBackup("manual")
  .then(async (backup) => {
    const written = join(backupDir(), backup.name);
    const copy = process.argv[2] ? resolve(process.argv[2]) : undefined;
    if (copy) await copyFile(written, copy);
    // Resolved paths, not the argument. "./backups/x.db" does not answer the
    // only question being asked, which is where the file actually is.
    const documents = `${backup.evidenceFiles} evidence document${backup.evidenceFiles === 1 ? "" : "s"}`;
    // eslint-disable-next-line no-console
    console.log(
      `Backup written to ${written} in ${Date.now() - started}ms: the database and ${documents}.` +
        (copy ? `\nCopied to ${copy}.` : ""),
    );
    return pool.end();
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
