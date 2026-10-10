import { lstat, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { downloadVerified, parseVersion, type FileArtifact } from "../update/release.js";
import { parseRequest, readSmallJson, REQUEST_FILE, type UpdateRequest } from "../update/files.js";
import { readVersion } from "../version.js";
import {
  ensureDir, errorText, loadSettings, Logger, resolveTarget, run, Status, waitForVersion,
} from "./common.js";

/**
 * The Linux updater.
 *
 * Run as root by offset-<product>-updater.service, which systemd starts when
 * the application leaves a request (offset-<product>-updater.path). It does one
 * request and exits; nothing privileged stays running.
 *
 * It installs a release the same way an administrator would: download the
 * signed tarball, check its hash, unpack it, and run its install.sh, which
 * already knows how to upgrade in place and refuses to report success unless
 * the application answers. If that fails, the previous /opt copy and the
 * database backup go back.
 *
 * The data folder belongs to the application's account, so the application
 * could have put links anywhere inside it. Root never writes there directly:
 * the request is removed, and the database restored, as that account.
 */

const product = process.argv[2] ?? "";
if (!/^[a-z]{2,20}$/.test(product)) {
  console.error("Usage: linux.js <product>");
  process.exit(2);
}

const SLUG = `offset-${product}`;
const APP = `/opt/${SLUG}`;
const DATA = `/var/lib/${SLUG}`;
const REQUESTS = join(DATA, "updates", "request");
const STATUS = join(DATA, "update-status");
const WORK = `/var/cache/${SLUG}-updater`;
const SETTINGS = `/etc/${SLUG}/updater.json`;

const log = new Logger(join(STATUS, "updater.log"));

/** Runs a command as the application's account. */
const asApp = (cmd: string, ...args: string[]) => run("runuser", ["-u", SLUG, "--", cmd, ...args]);

async function takeRequestAsApp(): Promise<UpdateRequest | null> {
  const path = join(REQUESTS, REQUEST_FILE);
  const raw = await readSmallJson<unknown>(path, 4096);
  await asApp("rm", "-f", path);
  return parseRequest(raw);
}

/** HOST, PORT and whether TLS is on, from the application's settings. Read-only use. */
async function listening(): Promise<{ url: string }> {
  let text = "";
  try {
    text = await readFile(join(DATA, ".env"), "utf8");
  } catch {
    /* defaults */
  }
  const get = (key: string): string =>
    (text.split(/\r?\n/).reverse().find((l) => l.startsWith(`${key}=`)) ?? "").slice(key.length + 1).trim();
  const port = /^\d+$/.test(get("PORT")) ? get("PORT") : "8080";
  const host = get("HOST");
  const probeHost = !host || host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const tls = get("TLS_CERT_FILE") !== "";
  return { url: `${tls ? "https" : "http"}://${probeHost}:${port}` };
}

async function restoreDatabase(backup: string): Promise<void> {
  const db = join(DATA, "data", "offset.db");
  const from = join(DATA, "backups", backup);
  for (const [cmd, ...args] of [
    ["cp", "--", from, `${db}.restoring`],
    ["rm", "-f", "--", `${db}-wal`, `${db}-shm`],
    ["mv", "-f", "--", `${db}.restoring`, db],
  ] as string[][]) {
    const r = await asApp(cmd!, ...args);
    if (r.code !== 0) throw new Error(`restoring the database failed at ${cmd}: ${r.stderr.trim()}`);
  }
}

async function systemctl(...args: string[]): Promise<void> {
  await run("systemctl", args, { timeoutMs: 120_000 });
}

async function update(request: UpdateRequest): Promise<void> {
  const current = readVersion(APP);
  const status = new Status(STATUS, request, current, log);
  await status.set("queued", "Checking the release.");

  let artifact: FileArtifact;
  let allowHttp = false;
  try {
    const settings = await loadSettings(SETTINGS, product);
    allowHttp = settings.allowHttp;
    ({ artifact } = await resolveTarget(request, current, product, "linux", settings));
  } catch (err) {
    await status.set("failed", errorText(err));
    return;
  }

  const tarball = join(WORK, "release.tar.gz");
  const unpacked = join(WORK, "new");
  const previous = join(WORK, "previous");

  try {
    await status.set("downloading", "Downloading the new version.");
    await rm(unpacked, { recursive: true, force: true });
    await downloadVerified(artifact, tarball, { allowHttp });

    ensureDir(unpacked, 0o700);
    const untar = await run("tar", ["-xzf", tarball, "-C", unpacked, "--no-same-owner"]);
    if (untar.code !== 0) throw new Error(`the download could not be unpacked: ${untar.stderr.trim()}`);
    const bundled = readVersion(join(unpacked, SLUG, "app"));
    if (bundled !== request.version) {
      throw new Error(`the package says it is ${bundled}, not ${request.version}`);
    }
  } catch (err) {
    await status.set("failed", `Nothing was changed. ${errorText(err)}`);
    return;
  }

  const { url } = await listening();
  try {
    await rm(previous, { recursive: true, force: true });
    const copy = await run("cp", ["-a", "--", APP, previous]);
    if (copy.code !== 0) throw new Error(`could not keep a copy of the current version: ${copy.stderr.trim()}`);

    await status.set("installing", "Installing and restarting.");
    const install = await run("bash", [join(unpacked, SLUG, "install.sh")], {
      timeoutMs: 15 * 60_000,
      cwd: join(unpacked, SLUG),
      env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8" },
    });
    log.line(install.stdout.trim());
    if (install.code !== 0) throw new Error(`the installer reported a failure: ${install.stderr.trim().split("\n").pop() ?? ""}`);

    await status.set("verifying", "Checking the new version answers.");
    if (readVersion(APP) !== request.version) throw new Error("the installed files are not the new version");
    if (!(await waitForVersion(url, request.version, 120_000))) {
      throw new Error(`${request.version} did not answer within two minutes`);
    }
  } catch (err) {
    await status.set("failed", `${errorText(err)}. Putting the previous version back.`);
    try {
      await systemctl("stop", `${SLUG}-worker`, SLUG);
      const hasPrevious = await lstat(previous).then((s) => s.isDirectory()).catch(() => false);
      if (hasPrevious) {
        await rm(APP, { recursive: true, force: true });
        const back = await run("cp", ["-a", "--", previous, APP]);
        if (back.code !== 0) throw new Error(`could not put the previous files back: ${back.stderr.trim()}`);
      }
      await restoreDatabase(request.backup);
      await systemctl("start", SLUG, `${SLUG}-worker`);
      const answered = await waitForVersion(url, current, 120_000);
      await status.set(
        "rolled_back",
        answered
          ? `The update did not work, so ${current} was put back with the database as it was before.`
          : `The update did not work and ${current} did not come back either. See journalctl -u ${SLUG}.`,
      );
    } catch (rollbackErr) {
      await status.set("failed", `Rollback failed too: ${errorText(rollbackErr)}. See journalctl -u ${SLUG}.`);
    }
    return;
  }

  await status.set("done", `Updated to ${request.version}.`);
  await rm(unpacked, { recursive: true, force: true });
  await rm(previous, { recursive: true, force: true });
  await rm(tarball, { force: true });
}

async function main(): Promise<void> {
  // The work folder is root's alone. If it is anything but a real folder,
  // something is wrong and nothing should be installed from it.
  ensureDir(WORK, 0o700);
  const work = await lstat(WORK);
  if (!work.isDirectory() || work.uid !== 0 || (work.mode & 0o077) !== 0) {
    log.line(`${WORK} is not a private root-owned folder; refusing to update.`);
    process.exit(1);
  }

  const request = await takeRequestAsApp();
  if (!request) return;
  if (!parseVersion(request.version)) return;
  try {
    await update(request);
  } catch (err) {
    log.line(`update crashed: ${errorText(err)}`);
  }
}

void main();
