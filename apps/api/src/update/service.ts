import { join, resolve } from "node:path";
import { config, product } from "../config.js";
import { backupTo, query } from "../db/pool.js";
import { pruneBackups } from "../backup/service.js";
import { APP_VERSION } from "../version.js";
import {
  fetchRelease, isNewer, ReleaseError, TRUSTED_KEYS, type Release,
} from "./release.js";
import {
  newRequestId, PRESENCE_FILE, readSmallJson, REQUEST_FILE, STATUS_FILE, writeJsonAtomic,
  type UpdateRequest, type UpdateStatus, type UpdaterPresence,
} from "./files.js";

/**
 * The application's half of updating: find out whether there is something
 * newer, and ask for it.
 *
 * It never installs anything. It cannot: on every kind of install the
 * application runs with less privilege than replacing itself needs, and that
 * is the point. What it can do is take a backup, which it is best placed to do
 * because it holds the database open, and leave a request the updater checks
 * again from scratch.
 */

export interface CheckResult {
  checkedAt: string;
  current: string;
  latest: string | null;
  published: string | null;
  notes: string;
  /** A newer version exists. */
  newer: boolean;
  /** And there is a package for this kind of install, so the button can offer it. */
  installable: boolean;
  error: string | null;
}

export interface UpdaterState {
  present: boolean;
  seenAt: string | null;
}

const SETTINGS_KEY = "updates.lastCheck";

/** A Docker updater polls every 15 seconds; three minutes of silence means it has stopped. */
const DOCKER_STALE_MS = 3 * 60_000;

/** An in-progress state older than this is treated as abandoned, not as blocking. */
const IN_PROGRESS_STALE_MS = 45 * 60_000;

const IN_PROGRESS = new Set(["queued", "downloading", "installing", "verifying"]);

export function trustedKeys(): string[] {
  const custom = config.UPDATE_TRUSTED_KEYS.split(",").map((k) => k.trim()).filter(Boolean);
  return custom.length ? custom : [...TRUSTED_KEYS];
}

export const usingCustomKeys = (): boolean => config.UPDATE_TRUSTED_KEYS.trim() !== "";

async function latestRelease(): Promise<Release> {
  return fetchRelease(config.UPDATE_URL, {
    keys: trustedKeys(),
    allowHttp: config.UPDATE_ALLOW_HTTP === "true",
  });
}

function hasPackage(release: Release): boolean {
  if (config.INSTALL_KIND === "none") return false;
  return Boolean(release.products[config.PRODUCT]?.[config.INSTALL_KIND]);
}

export async function checkForUpdates(): Promise<CheckResult> {
  const base = { checkedAt: new Date().toISOString(), current: APP_VERSION };
  let result: CheckResult;
  try {
    const release = await latestRelease();
    result = {
      ...base,
      latest: release.version,
      published: release.published,
      notes: release.notes,
      newer: isNewer(release.version, APP_VERSION),
      installable: hasPackage(release),
      error: null,
    };
  } catch (err) {
    result = {
      ...base,
      latest: null,
      published: null,
      notes: "",
      newer: false,
      installable: false,
      error: err instanceof ReleaseError ? err.message : "The update check failed unexpectedly.",
    };
  }

  await query(
    `insert into settings (key, value, updated_at)
     values ($1, $2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [SETTINGS_KEY, JSON.stringify(result)],
  );
  return result;
}

export async function lastCheck(): Promise<CheckResult | null> {
  const { rows } = await query<{ value: string }>("select value from settings where key = $1", [SETTINGS_KEY]);
  if (!rows[0]) return null;
  try {
    const saved = JSON.parse(rows[0].value) as CheckResult;
    // A check made before this copy was updated describes a different copy.
    return saved.current === APP_VERSION ? saved : null;
  } catch {
    return null;
  }
}

export async function updaterState(): Promise<UpdaterState> {
  if (config.INSTALL_KIND === "none") return { present: false, seenAt: null };
  const p = await readSmallJson<UpdaterPresence>(join(config.UPDATE_STATUS_DIR, PRESENCE_FILE));
  if (!p || p.kind !== config.INSTALL_KIND) return { present: false, seenAt: null };
  if (p.kind === "docker") {
    const seen = p.seenAt ? Date.parse(p.seenAt) : Number.NaN;
    const fresh = !Number.isNaN(seen) && Date.now() - seen < DOCKER_STALE_MS;
    return { present: fresh, seenAt: p.seenAt ?? null };
  }
  return { present: true, seenAt: p.seenAt ?? p.installedAt ?? null };
}

export async function currentStatus(): Promise<UpdateStatus | null> {
  return readSmallJson<UpdateStatus>(join(config.UPDATE_STATUS_DIR, STATUS_FILE));
}

const refuse = (message: string): never => {
  throw new ReleaseError(message);
};

/**
 * Asks for an update to `version`.
 *
 * Checks everything again rather than trusting the last check: the release
 * could have changed since the page loaded, and a request for a version that
 * is not the signed latest is a request nobody should act on.
 */
export async function requestUpdate(version: string, requestedBy: string): Promise<UpdateRequest> {
  if (config.INSTALL_KIND === "none") {
    refuse("This copy was not installed with an updater, so it cannot update itself. Install the newer version with its installer.");
  }
  const updater = await updaterState();
  if (!updater.present) {
    refuse(
      config.INSTALL_KIND === "docker"
        ? "The updater container is not running. Add COMPOSE_PROFILES=updates to .env, then run: docker compose up -d"
        : "The updater for this install is missing. Reinstall with the latest installer to add it.",
    );
  }

  const status = await currentStatus();
  if (status && IN_PROGRESS.has(status.state) && Date.now() - Date.parse(status.updatedAt) < IN_PROGRESS_STALE_MS) {
    refuse(`An update to ${status.version} is already in progress.`);
  }

  const release = await latestRelease();
  if (release.version !== version) {
    refuse(`${version} is not the latest release any more; ${release.version} is. Check again.`);
  }
  if (!isNewer(release.version, APP_VERSION)) refuse(`This copy is already on ${APP_VERSION}.`);
  if (!hasPackage(release)) {
    refuse(`Release ${version} has no ${config.INSTALL_KIND} package for ${product.name}.`);
  }

  // Before asking, not after: once the updater has the request, the next
  // thing to happen to this database may be a migration.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `pre-update-${version}-${stamp}.db`;
  await backupTo(join(resolve(config.BACKUP_DIR), backup));
  // The folder keeps BACKUP_KEEP backups in all; this one is never the one to go.
  await pruneBackups([backup]);

  const request: UpdateRequest = {
    id: newRequestId(),
    version,
    backup,
    requestedBy,
    requestedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(join(config.UPDATE_REQUEST_DIR, REQUEST_FILE), request, 0o644);
  return request;
}
