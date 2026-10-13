import { spawn } from "node:child_process";
import { request as httpGet } from "node:http";
import { request as httpsGet } from "node:https";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  fetchRelease, isNewer, releaseUrlFor, ReleaseError, TRUSTED_KEYS,
  type InstallKind, type ProductRelease, type Release,
} from "../update/release.js";
import {
  PRESENCE_FILE, readSmallJson, STATUS_FILE, writeJsonAtomic,
  type UpdateRequest, type UpdateState, type UpdateStatus, type UpdaterPresence,
} from "../update/files.js";

/**
 * What the three updaters have in common.
 *
 * An updater is the privileged half of an update: it runs as root, as SYSTEM,
 * or with the Docker socket, and it is the only thing that replaces the
 * application. It takes nothing on trust from the application. The request
 * says which version somebody wants; everything else - whether that version is
 * real, signed, newer, and has a package for this install - is decided here,
 * from the release channel and from configuration the application cannot
 * write.
 */

export interface UpdaterSettings {
  url: string;
  keys: string[];
  allowHttp: boolean;
}

interface SettingsFile {
  url?: unknown;
  trustedKeys?: unknown;
  allowHttp?: unknown;
}

/**
 * Settings for the release channel, from a file only an administrator can
 * change, falling back to the built-in channel and keys.
 *
 * Absent is normal. It exists to point a test install at a test channel, or a
 * customer at their own mirror.
 */
export async function loadSettings(file: string | null, product: string): Promise<UpdaterSettings> {
  const raw = file ? await readSmallJson<SettingsFile>(file) : null;
  const keys = Array.isArray(raw?.trustedKeys)
    ? raw.trustedKeys.filter((k): k is string => typeof k === "string")
    : [];
  return {
    url: typeof raw?.url === "string" ? raw.url : releaseUrlFor(product),
    keys: keys.length ? keys : [...TRUSTED_KEYS],
    allowHttp: raw?.allowHttp === true,
  };
}

/** Settings for the Docker updater, which takes them from its own environment. */
export function settingsFromEnv(env: NodeJS.ProcessEnv, product: string): UpdaterSettings {
  const keys = (env["UPDATE_TRUSTED_KEYS"] ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  return {
    url: env["UPDATE_URL"] || releaseUrlFor(product),
    keys: keys.length ? keys : [...TRUSTED_KEYS],
    allowHttp: env["UPDATE_ALLOW_HTTP"] === "true",
  };
}

export class Logger {
  constructor(private readonly file: string) {}

  line(text: string): void {
    const stamped = `${new Date().toISOString()} ${text}`;
    // eslint-disable-next-line no-console
    console.log(stamped);
    try {
      appendFileSync(this.file, `${stamped}\n`);
    } catch {
      /* the console copy is enough */
    }
  }
}

/** Reports progress to the status folder, where the application can read it. */
export class Status {
  constructor(
    private readonly dir: string,
    private readonly request: UpdateRequest,
    private readonly from: string,
    private readonly log: Logger,
  ) {}

  async set(state: UpdateState, message: string): Promise<void> {
    const status: UpdateStatus = {
      requestId: this.request.id,
      version: this.request.version,
      from: this.from,
      state,
      message,
      updatedAt: new Date().toISOString(),
    };
    this.log.line(`[${state}] ${this.from} -> ${this.request.version}: ${message}`);
    await writeJsonAtomic(join(this.dir, STATUS_FILE), status, 0o644);
  }
}

export async function lastStatus(dir: string): Promise<UpdateStatus | null> {
  return readSmallJson<UpdateStatus>(join(dir, STATUS_FILE));
}

export async function writePresence(dir: string, presence: UpdaterPresence): Promise<void> {
  await writeJsonAtomic(join(dir, PRESENCE_FILE), presence, 0o644);
}

/**
 * Turns a request into something safe to install, or refuses it.
 *
 * The request is only ever a wish. The version installed is the signed latest
 * release, and only if it is the one asked for and newer than what is running.
 */
export async function resolveTarget<K extends InstallKind>(
  request: UpdateRequest,
  current: string,
  product: string,
  kind: K,
  settings: UpdaterSettings,
): Promise<{ release: Release; artifact: NonNullable<ProductRelease[K]> }> {
  const release = await fetchRelease(settings.url, { keys: settings.keys, allowHttp: settings.allowHttp });
  if (release.version !== request.version) {
    throw new ReleaseError(`${request.version} was asked for, but the signed latest release is ${release.version}.`);
  }
  if (!isNewer(release.version, current)) {
    throw new ReleaseError(`${release.version} is not newer than the installed ${current}.`);
  }
  const artifact = release.products[product]?.[kind];
  if (!artifact) throw new ReleaseError(`Release ${release.version} has no ${kind} package for ${product}.`);
  return { release, artifact: artifact as NonNullable<ProductRelease[K]> };
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a program with arguments, never through a shell.
 *
 * Nothing that came from outside is ever pasted into a command line, so there
 * is no quoting to get wrong and nothing for a hostile string to break out of.
 */
export function run(
  cmd: string,
  args: string[],
  { timeoutMs = 10 * 60_000, env, cwd }: { timeoutMs?: number; env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: env ?? process.env, cwd, windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout = (stdout + String(c)).slice(-64_000); });
    child.stderr.on("data", (c) => { stderr = (stderr + String(c)).slice(-64_000); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Asks the application this updater looks after for a small JSON document.
 *
 * Not fetch, and with certificate checking off - for this call only. The
 * application may serve its own certificate, issued for the name people use
 * ("localhost", "grc.bank.local") rather than the name the updater reaches it
 * by ("app", "127.0.0.1"), and often self-signed. Checking it here would prove
 * nothing: this is the updater asking its neighbour whether it is up, and the
 * answer decides only whether to roll back. Release downloads still use fetch
 * and verify certificates as normal, and are signature-checked on top.
 */
export async function getLocalJson<T>(url: string, timeoutMs = 5000): Promise<{ status: number; body: T | null }> {
  // HTTP or HTTPS is not known for certain from outside: a certificate can be
  // uploaded on the Settings screen, and then the settings file does not say.
  // So if the scheme guessed is not answering, try the other. Plain HTTP to a
  // server on HTTPS gets a redirect, which counts as not answering.
  const first = await getOnce<T>(url, timeoutMs);
  if (first.status !== 0 && (first.status < 300 || first.status > 399)) return first;
  const u = new URL(url);
  u.protocol = u.protocol === "https:" ? "http:" : "https:";
  const second = await getOnce<T>(u.toString(), timeoutMs);
  return second.status === 0 ? first : second;
}

function getOnce<T>(url: string, timeoutMs: number): Promise<{ status: number; body: T | null }> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const get = u.protocol === "https:" ? httpsGet : httpGet;
    const req = get(
      u,
      { method: "GET", timeout: timeoutMs, rejectUnauthorized: false },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { if (text.length < 64_000) text += c; });
        res.on("end", () => {
          let body: T | null = null;
          try { body = JSON.parse(text) as T; } catch { /* not JSON */ }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", () => resolve({ status: 0, body: null }));
    req.end();
  });
}

/** Waits for the application to answer as `version`, over HTTP or HTTPS. */
export async function waitForVersion(baseUrl: string, version: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await getLocalJson(`${baseUrl}/api/v1/health/ready`);
    if (ready.status === 200) {
      const health = await getLocalJson<{ version?: string }>(`${baseUrl}/api/v1/health`);
      if (health.body?.version === version) return true;
    }
    await sleep(3000);
  }
  return false;
}

export function ensureDir(path: string, mode = 0o755): void {
  mkdirSync(path, { recursive: true, mode });
}

export const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
