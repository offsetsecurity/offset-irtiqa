import { spawn } from "node:child_process";
import { cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadVerified, type FileArtifact } from "../update/release.js";
import {
  isRealDirectory, parseRequest, readSmallJson, REQUEST_FILE, type UpdateRequest,
} from "../update/files.js";
import { readVersion } from "../version.js";
import {
  errorText, loadSettings, Logger, resolveTarget, run, sleep, Status, waitForVersion, writePresence,
} from "./common.js";

/**
 * The Windows updater.
 *
 * Registered by the installer as a scheduled task running as SYSTEM once a
 * minute. Most runs find no request and exit in well under a second.
 *
 * Two modes, because Windows will not replace a file that is in use:
 *
 *   --poll    run by the task, from the install folder. Looks for a request
 *             and, if there is one, copies node.exe and this code out to a
 *             private folder, starts that copy with --apply, and exits.
 *   --apply   the copy. Nothing it runs from is inside the install folder, so
 *             the installer can replace every file there.
 *
 * The request folder sits in ProgramData, where every local user may write,
 * so the request is only ever a wish, re-checked against the signed release.
 * Everything SYSTEM writes goes into its own folder that users can only read,
 * never into theirs.
 */

interface Args {
  mode: "poll" | "apply";
  install: string;
  data: string;
  request?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const mode = argv.includes("--apply") ? "apply" : "poll";
  const install = get("--install-dir");
  const data = get("--data-dir");
  if (!install || !data) {
    console.error("Usage: windows.js --poll|--apply --install-dir <dir> --data-dir <dir> [--request <file>]");
    process.exit(2);
  }
  return { mode, install: resolve(install), data: resolve(data), request: get("--request") };
}

const args = parseArgs(process.argv);

interface ProductInfo {
  product: string;
  display: string;
}

async function productInfo(): Promise<ProductInfo> {
  const info = await readSmallJson<ProductInfo>(join(args.install, "app", "product.json"));
  if (!info || !/^[a-z]{2,20}$/.test(info.product) || !/^Offset [A-Za-z]+$/.test(info.display)) {
    throw new Error("app\\product.json is missing or not recognised");
  }
  return info;
}

// Everything SYSTEM owns lives under here, beside the data folder rather than in it.
const updaterRoot = (display: string): string =>
  join(process.env["ProgramData"] ?? "C:\\ProgramData", "Offset Security", `${display} updater`);

// ── poll ─────────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  const info = await productInfo();
  const root = updaterRoot(info.display);
  const status = join(root, "status");
  const work = join(root, "work");

  // Created, with their permissions, by install-updater.ps1. If either is
  // missing or has been swapped for a link, something is wrong.
  if (!(await isRealDirectory(status)) || !(await isRealDirectory(work))) return;
  await writePresence(status, { kind: "windows", seenAt: new Date().toISOString() });

  const requests = join(args.data, "updates", "request");
  if (!(await isRealDirectory(join(args.data, "updates"))) || !(await isRealDirectory(requests))) return;

  const path = join(requests, REQUEST_FILE);
  const request = parseRequest(await readSmallJson(path, 4096));
  await rm(path, { force: true }).catch(() => undefined);
  if (!request) return;

  // Copy the request, node.exe and the updater code somewhere users cannot
  // write and the installer does not touch.
  const runner = join(work, "runner");
  await rm(runner, { recursive: true, force: true });
  await mkdir(join(runner, "dist"), { recursive: true });
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  for (const part of ["update", "updater", "version.js"]) {
    await cp(join(dist, part), join(runner, "dist", part), { recursive: true });
  }
  await cp(join(args.install, "node.exe"), join(runner, "node.exe"));
  // The code is ES modules; without this Node treats .js as CommonJS.
  await writeFile(join(runner, "package.json"), '{"type":"module"}');
  await writeFile(join(runner, "request.json"), JSON.stringify(request));

  const child = spawn(
    join(runner, "node.exe"),
    [
      join(runner, "dist", "updater", "windows.js"), "--apply",
      "--install-dir", args.install, "--data-dir", args.data,
      "--request", join(runner, "request.json"),
    ],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
}

// ── apply ────────────────────────────────────────────────────────────────────

const ps = (script: string, env: Record<string, string>) =>
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    env: { ...process.env, ...env },
    timeoutMs: 120_000,
  });

/**
 * Stops everything holding a file in the install folder, and waits for it to
 * let go.
 *
 * Matched on what each process actually has open, not on how it was started.
 * Two narrower rules were tried and both let a process through: the absolute
 * path of `start.js` on the command line (the Start Menu shortcut uses a
 * relative one), and then the bundled `node.exe` (a copy started with some
 * other Node - a developer's, a test - is not that executable). Each time the
 * survivor kept a file open, Windows refused to replace it, and the install
 * failed at `argon2.glibc.node` with "DeleteFile failed; code 5".
 *
 * Any process with a module loaded from the install folder is it: the
 * launcher, the API, the worker, whichever Node started them. Reading another
 * process's modules needs privilege, which this has, being SYSTEM. The
 * updater itself runs from a copy outside the folder, so it never matches.
 */
const holders = (stop: boolean): string =>
  "$dir = $env:OFFSET_INSTALL; " +
  "Get-Process -ErrorAction SilentlyContinue | ForEach-Object { " +
  "  $p = $_; " +
  "  try { " +
  "    $path = $p.Path; " +
  "    $hit = $path -and $path.StartsWith($dir, 'OrdinalIgnoreCase'); " +
  "    if (-not $hit) { $hit = @($p.Modules | Where-Object { $_.FileName.StartsWith($dir, 'OrdinalIgnoreCase') }).Count -gt 0 } " +
  "    if ($hit) { Write-Output $p.Id" +
  (stop ? "; Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue" : "") +
  " } " +
  "  } catch { } " +
  "}";

/** The same scan without the killing: what is still holding on. */
async function remainingHolders(): Promise<string[]> {
  const scan = await ps(holders(false), { OFFSET_INSTALL: args.install });
  return scan.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
}

/** Returns whatever would not let go, so the caller can say so in the log. */
async function stopApplication(display: string): Promise<string[]> {
  await run("schtasks.exe", ["/End", "/TN", display]);
  // Three rounds: a process can be restarted by its own launcher between the
  // kill and the check, and a handle can take a moment to be released after
  // the process is gone.
  let left: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    await ps(holders(true), { OFFSET_INSTALL: args.install });
    await sleep(3000);
    left = await remainingHolders();
    if (left.length === 0) break;
  }
  return left;
}

async function taskExists(name: string): Promise<boolean> {
  return (await run("schtasks.exe", ["/Query", "/TN", name])).code === 0;
}

async function listening(): Promise<{ url: string }> {
  let text = "";
  try {
    text = await readFile(join(args.data, ".env"), "utf8");
  } catch {
    /* defaults */
  }
  const get = (key: string): string =>
    (text.split(/\r?\n/).reverse().find((l) => l.startsWith(`${key}=`)) ?? "").slice(key.length + 1).trim();
  const port = /^\d+$/.test(get("PORT")) ? get("PORT") : "8080";
  const tls = get("TLS_CERT_FILE") !== "";
  return { url: `${tls ? "https" : "http"}://127.0.0.1:${port}` };
}

async function robocopy(from: string, to: string): Promise<void> {
  const r = await run("robocopy.exe", [from, to, "/MIR", "/R:2", "/W:2", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"], { timeoutMs: 15 * 60_000 });
  // robocopy reports success with any code below 8.
  if (r.code < 0 || r.code >= 8) throw new Error(`copying files failed (robocopy ${r.code})`);
}

/**
 * Deletes a file, waiting for Windows to let go of it first.
 *
 * A rollback runs seconds after the application was stopped, and a handle can
 * outlive the process that held it. A plain delete died on
 * "EBUSY: resource busy or locked, unlink ... offset.db-wal" and left the
 * database neither updated nor restored, which is the worst of the three.
 */
async function rmPatiently(path: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rm(path, { force: true });
      return;
    } catch (err) {
      if (attempt >= 5) throw err;
      await sleep(1000 * (attempt + 1));
    }
  }
}

async function restoreDatabase(backup: string): Promise<void> {
  const dataDir = join(args.data, "data");
  const backups = join(args.data, "backups");
  // Both folders are writable by local users; a junction in either would send
  // SYSTEM's copy somewhere else entirely.
  if (!(await isRealDirectory(dataDir)) || !(await isRealDirectory(backups))) {
    throw new Error("the data or backup folder is not a plain folder");
  }
  const db = join(dataDir, "offset.db");
  await cp(join(backups, backup), `${db}.restoring`, { force: true });
  await rmPatiently(`${db}-wal`);
  await rmPatiently(`${db}-shm`);
  await rmPatiently(db);
  await cp(`${db}.restoring`, db);
  await rm(`${db}.restoring`, { force: true });
}

async function apply(): Promise<void> {
  const info = await productInfo();
  const root = updaterRoot(info.display);
  const statusDir = join(root, "status");
  const work = join(root, "work");
  const log = new Logger(join(statusDir, "updater.log"));
  const updaterTask = `${info.display} Updater`;

  const request = parseRequest(await readSmallJson<unknown>(args.request ?? "", 4096)) as UpdateRequest | null;
  if (!request) return;

  const current = readVersion(join(args.install, "app"));
  const status = new Status(statusDir, request, current, log);
  await status.set("queued", "Checking the release.");

  let artifact: FileArtifact;
  let allowHttp = false;
  try {
    const settings = await loadSettings(join(args.install, "updater.json"), info.product);
    allowHttp = settings.allowHttp;
    ({ artifact } = await resolveTarget(request, current, info.product, "windows", settings));
  } catch (err) {
    await status.set("failed", errorText(err));
    return;
  }

  const setup = join(work, "setup.exe");
  try {
    await status.set("downloading", "Downloading the new version.");
    await downloadVerified(artifact, setup, { allowHttp });
  } catch (err) {
    await status.set("failed", `Nothing was changed. ${errorText(err)}`);
    return;
  }

  const asService = await taskExists(info.display);
  const previous = join(work, "previous");
  const { url } = await listening();

  // The minute trigger would otherwise start a poller from the install folder
  // halfway through, holding node.exe open under the installer.
  await run("schtasks.exe", ["/Change", "/TN", updaterTask, "/DISABLE"]);

  try {
    await status.set("installing", "Installing and restarting.");
    const left = await stopApplication(info.display);
    if (left.length > 0) {
      // Not fatal on its own - the installer may still manage - but it is the
      // one thing worth knowing when it comes back with "DeleteFile failed".
      log.line(`Still holding files in the install folder: process ${left.join(", ")}.`);
    }
    await rm(previous, { recursive: true, force: true });
    await robocopy(args.install, previous);

    const install = await run(setup, [
      "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", `/LOG=${join(work, "install.log")}`,
    ], { timeoutMs: 20 * 60_000 });
    if (install.code !== 0) throw new Error(`the installer exited with code ${install.code}`);

    await status.set("verifying", "Checking the new version.");
    if (readVersion(join(args.install, "app")) !== request.version) {
      throw new Error("the installed files are not the new version");
    }
    if (asService && !(await waitForVersion(url, request.version, 180_000))) {
      throw new Error(`${request.version} did not answer within three minutes`);
    }
  } catch (err) {
    await status.set("failed", `${errorText(err)}. Putting the previous version back.`);
    try {
      await stopApplication(info.display);
      if (await lstat(previous).then((s) => s.isDirectory()).catch(() => false)) {
        await robocopy(previous, args.install);
      }
      await restoreDatabase(request.backup);
      if (asService) await run("schtasks.exe", ["/Run", "/TN", info.display]);
      const back = !asService || (await waitForVersion(url, current, 180_000));
      await status.set(
        "rolled_back",
        back
          ? `The update did not work, so ${current} was put back with the database as it was before.`
          : `The update did not work and ${current} did not come back either. See the logs folder.`,
      );
    } catch (rollbackErr) {
      await status.set("failed", `Rollback failed too: ${errorText(rollbackErr)}. See the logs folder.`);
    }
    await run("schtasks.exe", ["/Change", "/TN", updaterTask, "/ENABLE"]);
    return;
  }

  await run("schtasks.exe", ["/Change", "/TN", updaterTask, "/ENABLE"]);
  await status.set(
    "done",
    asService
      ? `Updated to ${request.version}.`
      : `Updated to ${request.version}. It does not run as a background service, so start it again from the Start menu.`,
  );
  await rm(previous, { recursive: true, force: true });
  await rm(setup, { force: true });
}

(args.mode === "apply" ? apply() : poll()).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(errorText(err));
  process.exit(1);
});
