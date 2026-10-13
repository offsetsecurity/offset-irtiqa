import { chown, copyFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { parseRequest, readSmallJson, REQUEST_FILE } from "../update/files.js";
import type { DockerArtifact } from "../update/release.js";
import {
  errorText, getLocalJson, lastStatus, Logger, resolveTarget, run, settingsFromEnv, sleep, Status,
  waitForVersion, writePresence,
} from "./common.js";

/**
 * The Docker updater: a separate container beside the application.
 *
 * It holds the Docker socket, which is the same as holding the machine, so it
 * has no web page, listens on nothing, and reads only two things from outside:
 * a request the application leaves in a volume it mounts read-only, and the
 * signed release channel. Its settings come from the install folder's .env,
 * which the application container cannot see.
 *
 * An update is a change of image, not of files. The new images are pulled by
 * digest from the signed release, written into .env, and compose recreates the
 * application and worker from them. The data volumes are untouched. If the new
 * version does not come up answering as itself, the old images go back and the
 * database is restored from the backup the application took before asking.
 */

const env = process.env;
const PRODUCT = env["PRODUCT"] ?? "";
const PROJECT = `offset-${PRODUCT}`;
const INSTALL = env["UPDATER_INSTALL_DIR"] ?? "/install";
const REQUESTS = env["UPDATER_REQUEST_DIR"] ?? "/updates/request";
const STATUS = env["UPDATER_STATUS_DIR"] ?? "/updates/status";
const DATA = env["UPDATER_DATA_DIR"] ?? "/app/data";
const BACKUPS = env["UPDATER_BACKUP_DIR"] ?? "/app/backups";
// HTTPS when the application serves its own certificate. compose passes
// TLS_CERT_FILE through for exactly this.
const APP_URL = env["UPDATER_APP_URL"] || `${env["TLS_CERT_FILE"] ? "https" : "http"}://app:8080`;
const POLL_MS = 15_000;

/** The application's user inside the image. See the Dockerfile. */
const APP_UID = 10001;

const log = new Logger(join(STATUS, "updater.log"));

/**
 * The install folder as the Docker engine knows it.
 *
 * compose runs here, inside a container, but the paths it hands the engine are
 * resolved on the host. A relative "./certs" would become "/install/certs",
 * which does not exist on the host, and the recreated application would come
 * up without its certificate. So bind mounts are written in compose.yaml as
 * ${OFFSET_INSTALL_DIR:-.}/..., and this supplies the real folder, read from
 * this container's own mounts.
 *
 * Docker Desktop reports a Windows folder as C:\Users\...; a Linux client
 * cannot say that (the colon splits it), so it is given as the path Docker
 * Desktop exposes the same drive under.
 */
async function hostInstallDir(): Promise<string> {
  const inspect = await run("docker", ["inspect", hostname()]);
  if (inspect.code !== 0) throw new Error("could not inspect the updater container");
  const [me] = JSON.parse(inspect.stdout) as { Mounts: { Destination: string; Source: string }[] }[];
  const source = me?.Mounts.find((m) => m.Destination === INSTALL)?.Source;
  if (!source) throw new Error("could not find where the install folder is");
  const windows = /^([A-Za-z]):[\\/](.*)$/.exec(source);
  return windows
    ? `/run/desktop/mnt/host/${windows[1]!.toLowerCase()}/${windows[2]!.replace(/\\/g, "/")}`
    : source;
}

async function compose(...args: string[]) {
  return run(
    "docker",
    ["compose", "-p", PROJECT, "-f", join(INSTALL, "compose.yaml"), "--project-directory", INSTALL, ...args],
    { env: { ...process.env, OFFSET_INSTALL_DIR: await hostInstallDir() } },
  );
}

// ── .env ─────────────────────────────────────────────────────────────────────

type EnvEdits = Record<string, string | null>;

/** Sets or removes lines in .env, keeping every other line exactly as it was. */
async function editEnv(edits: EnvEdits): Promise<Record<string, string | null>> {
  const path = join(INSTALL, ".env");
  const lines = (await readFile(path, "utf8")).split(/\r?\n/);
  const before: Record<string, string | null> = {};
  for (const key of Object.keys(edits)) {
    const line = lines.find((l) => l.startsWith(`${key}=`));
    before[key] = line ? line.slice(key.length + 1) : null;
  }
  let out = lines.filter((l) => !Object.keys(edits).some((k) => l.startsWith(`${k}=`)));
  while (out.length && out[out.length - 1] === "") out.pop();
  for (const [key, value] of Object.entries(edits)) {
    if (value !== null) out = [...out, `${key}=${value}`];
  }
  const tmp = `${path}.updating`;
  await writeFile(tmp, `${out.join("\n")}\n`);
  await rename(tmp, path);
  return before;
}

// ── the update ───────────────────────────────────────────────────────────────

async function currentVersion(): Promise<string | null> {
  const res = await getLocalJson<{ version?: string }>(`${APP_URL}/api/v1/health`);
  return res.body?.version ?? null;
}

async function pull(ref: string): Promise<void> {
  const r = await run("docker", ["pull", ref], { timeoutMs: 30 * 60_000 });
  if (r.code !== 0) throw new Error(`could not download ${ref}: ${r.stderr.trim().split("\n").pop()}`);
}

async function restoreDatabase(backup: string): Promise<void> {
  const target = join(DATA, "offset.db");
  await copyFile(join(BACKUPS, backup), `${target}.restoring`);
  // The write-ahead log belongs to the database being replaced. Leaving it
  // would replay the failed version's writes over the restored file.
  await rm(`${target}-wal`, { force: true });
  await rm(`${target}-shm`, { force: true });
  await rename(`${target}.restoring`, target);
  await chown(target, APP_UID, APP_UID);
}

/**
 * Replaces this container with one from the new updater image.
 *
 * It cannot recreate itself directly - compose would stop the process running
 * compose. So a short-lived container from the new image does it, with the
 * same socket and the same install folder, found by asking Docker what this
 * container has mounted.
 */
async function replaceSelf(updaterRef: string): Promise<void> {
  const installSource = await hostInstallDir();

  const r = await run("docker", [
    "run", "-d", "--rm", "--name", `${PROJECT}-updater-swap`,
    "-v", "/var/run/docker.sock:/var/run/docker.sock",
    "-v", `${installSource}:/install`,
    "-e", `OFFSET_INSTALL_DIR=${installSource}`,
    "--entrypoint", "docker",
    updaterRef,
    "compose", "-p", PROJECT, "-f", "/install/compose.yaml", "--project-directory", "/install",
    "up", "-d", "--no-deps", "--force-recreate", "updater",
  ]);
  if (r.code !== 0) throw new Error(`could not start the updater swap: ${r.stderr.trim()}`);
}

async function update(request: NonNullable<ReturnType<typeof parseRequest>>): Promise<void> {
  const from = (await currentVersion()) ?? "unknown";
  const status = new Status(STATUS, request, from, log);
  await status.set("queued", "Checking the release.");

  let artifact: DockerArtifact;
  try {
    if (from === "unknown") throw new Error("the application is not answering, so there is nothing safe to update");
    ({ artifact } = await resolveTarget(request, from, PRODUCT, "docker", settingsFromEnv(env, PRODUCT)));
  } catch (err) {
    await status.set("failed", errorText(err));
    return;
  }

  const appRef = `${artifact.image}@${artifact.digest}`;
  const updaterRef = `${artifact.updaterImage}@${artifact.updaterDigest}`;

  try {
    await status.set("downloading", "Downloading the new version.");
    await pull(appRef);
    await pull(updaterRef);
  } catch (err) {
    await status.set("failed", `Nothing was changed. ${errorText(err)}`);
    return;
  }

  // From here on something has changed, so any failure rolls back.
  let previous: Record<string, string | null> = {};
  try {
    await status.set("installing", "Restarting on the new version.");
    previous = await editEnv({ OFFSET_IMAGE: appRef, OFFSET_UPDATER_IMAGE: updaterRef });
    const up = await compose("up", "-d", "--no-deps", "app", "worker");
    if (up.code !== 0) throw new Error(`compose could not start it: ${up.stderr.trim().split("\n").pop()}`);

    await status.set("verifying", "Waiting for the new version to answer.");
    if (!(await waitForVersion(APP_URL, request.version, 180_000))) {
      throw new Error(`${request.version} did not come up within three minutes`);
    }
  } catch (err) {
    await status.set("failed", `${errorText(err)}. Putting the previous version back.`);
    try {
      await editEnv({ OFFSET_IMAGE: previous["OFFSET_IMAGE"] ?? null, OFFSET_UPDATER_IMAGE: previous["OFFSET_UPDATER_IMAGE"] ?? null });
      await compose("stop", "app", "worker");
      await restoreDatabase(request.backup);
      await compose("up", "-d", "--no-deps", "app", "worker");
      const back = from !== "unknown" && (await waitForVersion(APP_URL, from, 180_000));
      await status.set(
        "rolled_back",
        back
          ? `The update did not work, so ${from} was put back with the database as it was before. Nothing was lost except changes made during the attempt.`
          : `The update did not work and ${from} did not come back either. Restore by hand: see RESTORE.md.`,
      );
    } catch (rollbackErr) {
      await status.set("failed", `Rollback failed too: ${errorText(rollbackErr)}. See RESTORE.md.`);
    }
    return;
  }

  await status.set("done", `Updated to ${request.version}.`);
  try {
    await replaceSelf(updaterRef);
  } catch (err) {
    // The application is updated either way; an old updater still works.
    log.line(`could not replace the updater itself: ${errorText(err)}`);
  }
}

// ── the loop ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!/^[a-z]{2,20}$/.test(PRODUCT)) {
    log.line("PRODUCT is not set; the updater has nothing to update.");
    process.exit(1);
  }
  log.line(`updater for ${PROJECT} watching ${REQUESTS}`);

  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; });

  while (!stopping) {
    try {
      await writePresence(STATUS, { kind: "docker", seenAt: new Date().toISOString() });
      const request = parseRequest(await readSmallJson(join(REQUESTS, REQUEST_FILE), 4096));
      // The request volume is read-only here, so a request cannot be removed
      // once handled. It is recognised as handled by its id instead.
      if (request && request.id !== (await lastStatus(STATUS))?.requestId) {
        await update(request);
      }
    } catch (err) {
      log.line(`updater loop error: ${errorText(err)}`);
    }
    await sleep(POLL_MS);
  }
  process.exit(0);
}

void main();

