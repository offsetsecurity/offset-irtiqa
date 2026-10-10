import { createHash, createPublicKey, verify } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";

/**
 * Releases: what one is, how to trust it, and how to fetch its files.
 *
 * Shared by the application, which only reads a release and asks for it to be
 * installed, and by the three updaters, which install it with far more
 * privilege than the application has. So this file imports nothing from the
 * application: not config, not the database, not the logger. An updater that
 * loaded config.ts would read the application's own settings file, and on
 * Linux the application can write that file. Trust has to come from somewhere
 * the application cannot reach.
 *
 * A release is a JSON manifest plus a detached Ed25519 signature over its exact
 * bytes. The manifest names every file by its SHA-256 (or, for container
 * images, by digest), so one signature covers everything the release installs.
 * Nothing is installed that the signature does not vouch for.
 */

export type InstallKind = "docker" | "linux" | "windows";

export interface FileArtifact {
  url: string;
  sha256: string;
  size: number;
}

export interface DockerArtifact {
  /** Repository without tag or digest, e.g. ghcr.io/offsetsecurity/offset-ascend. */
  image: string;
  /** sha256:… — images are always pulled by digest, never by a movable tag. */
  digest: string;
  updaterImage: string;
  updaterDigest: string;
}

export interface ProductRelease {
  docker?: DockerArtifact;
  linux?: FileArtifact;
  windows?: FileArtifact;
}

export interface Release {
  schema: 1;
  version: string;
  published: string;
  notes: string;
  products: Record<string, ProductRelease>;
}

/**
 * Where this product looks for its own releases: its own repository.
 *
 * "The latest release" belongs to a repository, so this only works because
 * nothing else publishes here. That is the whole reason the products stopped
 * sharing a downloads page: with five on one page, shipping any of them made
 * it the latest release for the other four.
 *
 * A mirror can be named instead, in updater.json or UPDATE_URL. It is verified
 * against the same keys either way.
 */
const RELEASE_REPO = "offsetsecurity/offset-irtiqa";

export function releaseUrlFor(product: string): string {
  if (product !== "ascend") {
    throw new ReleaseError(`No release channel is known for "${product}".`);
  }
  return `https://github.com/${RELEASE_REPO}/releases/latest/download/release.json`;
}

/**
 * The address installs made before the split still use.
 *
 * Those copies were built with this compiled in and go on asking for it, so
 * the old page stays where it is and they keep updating from it until they are
 * reinstalled. Nothing new points here.
 */
export const LEGACY_RELEASE_URL =
  "https://github.com/offsetsecurity/grc-suite-releases/releases/latest/download/release.json";

/**
 * Public keys whose signatures are accepted, as base64url raw Ed25519 keys.
 *
 * More than one so the signing key can be rotated: ship a build that trusts
 * both, then start signing with the new one. The private half never enters
 * this repository; it lives in the release workflow's secrets.
 */
export const TRUSTED_KEYS: readonly string[] = [
  // Offset Security release signing key, created 2026-09-17.
  "1QAMdACftcW3XVVGntM_WpSR6u2xTVsVqgz9e7gvmss",
];

// ── versions ─────────────────────────────────────────────────────────────────

const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

/** Strict x.y.z. Anything else is not a version this product publishes. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = VERSION.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Whether `candidate` is strictly newer than `current`.
 *
 * Strictly, because installing the same version again achieves nothing, and
 * installing an older one is how a vulnerability that has been fixed gets put
 * back. A signed old release is still an old release.
 */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

// ── trust ────────────────────────────────────────────────────────────────────

export class ReleaseError extends Error {}

const SHA256 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IMAGE = /^[a-z0-9.-]+(:\d+)?(\/[a-z0-9._-]+)+$/;
const PRODUCT = /^[a-z]{2,20}$/;

function keyObject(raw: string) {
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw }, format: "jwk" });
}

/** Usable keys only. A placeholder or a malformed entry is skipped, not trusted. */
export function usableKeys(keys: readonly string[]): string[] {
  return keys.filter((k) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(k)) return false;
    try {
      keyObject(k);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Checks the signature, then the shape, and returns the release.
 *
 * In that order on purpose: nothing in an unsigned body is parsed beyond what
 * JSON.parse needs, so a malformed manifest from an attacker never reaches the
 * code that interprets one.
 */
export function verifyRelease(
  body: Buffer,
  signatureB64: string,
  keys: readonly string[],
  { allowHttp = false }: { allowHttp?: boolean } = {},
): Release {
  const usable = usableKeys(keys);
  if (usable.length === 0) {
    throw new ReleaseError("No release signing key is configured, so no update can be trusted.");
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(signatureB64.trim(), "base64");
  } catch {
    throw new ReleaseError("The release signature is not readable.");
  }
  if (signature.length !== 64) throw new ReleaseError("The release signature is not readable.");

  const signed = usable.some((k) => {
    try {
      return verify(null, body, keyObject(k), signature);
    } catch {
      return false;
    }
  });
  if (!signed) {
    throw new ReleaseError(
      "The release is not signed by Offset Security. It has been refused, and nothing was installed.",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body.toString("utf8"));
  } catch {
    throw new ReleaseError("The release manifest is not valid JSON.");
  }
  return validateRelease(raw, { allowHttp });
}

function fail(what: string): never {
  throw new ReleaseError(`The release manifest is malformed: ${what}.`);
}

function checkUrl(url: unknown, allowHttp: boolean, what: string): string {
  if (typeof url !== "string") fail(`${what} has no URL`);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    fail(`${what} has an invalid URL`);
  }
  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) {
    fail(`${what} is not served over HTTPS`);
  }
  return url;
}

function checkFile(a: unknown, allowHttp: boolean, what: string): FileArtifact {
  if (!a || typeof a !== "object") fail(what);
  const f = a as Record<string, unknown>;
  if (typeof f["sha256"] !== "string" || !SHA256.test(f["sha256"])) fail(`${what} has no valid SHA-256`);
  if (typeof f["size"] !== "number" || !Number.isInteger(f["size"]) || f["size"] <= 0 || f["size"] > 2 ** 31) {
    fail(`${what} has no valid size`);
  }
  return { url: checkUrl(f["url"], allowHttp, what), sha256: f["sha256"], size: f["size"] };
}

/** Validates everything the updaters will act on, and drops anything else. */
export function validateRelease(raw: unknown, { allowHttp = false } = {}): Release {
  if (!raw || typeof raw !== "object") fail("not an object");
  const r = raw as Record<string, unknown>;
  if (r["schema"] !== 1) fail("unknown schema");
  if (typeof r["version"] !== "string" || !parseVersion(r["version"])) fail("no valid version");
  if (typeof r["published"] !== "string" || Number.isNaN(Date.parse(r["published"]))) fail("no valid date");
  const notes = typeof r["notes"] === "string" ? r["notes"].slice(0, 20_000) : "";
  if (!r["products"] || typeof r["products"] !== "object") fail("no products");

  const products: Record<string, ProductRelease> = {};
  for (const [id, value] of Object.entries(r["products"] as Record<string, unknown>)) {
    if (!PRODUCT.test(id) || !value || typeof value !== "object") fail(`bad product ${id}`);
    const p = value as Record<string, unknown>;
    const out: ProductRelease = {};

    if (p["docker"] !== undefined) {
      const d = p["docker"] as Record<string, unknown>;
      for (const [key, pattern] of [
        ["image", IMAGE], ["digest", DIGEST], ["updaterImage", IMAGE], ["updaterDigest", DIGEST],
      ] as const) {
        if (typeof d?.[key] !== "string" || !pattern.test(d[key] as string)) fail(`${id} docker ${key}`);
      }
      out.docker = {
        image: d["image"] as string,
        digest: d["digest"] as string,
        updaterImage: d["updaterImage"] as string,
        updaterDigest: d["updaterDigest"] as string,
      };
    }
    if (p["linux"] !== undefined) out.linux = checkFile(p["linux"], allowHttp, `${id} linux`);
    if (p["windows"] !== undefined) out.windows = checkFile(p["windows"], allowHttp, `${id} windows`);
    products[id] = out;
  }

  return {
    schema: 1,
    version: r["version"] as string,
    published: r["published"] as string,
    notes,
    products,
  };
}

// ── fetching ─────────────────────────────────────────────────────────────────

export interface FetchOptions {
  keys: readonly string[];
  allowHttp?: boolean;
  timeoutMs?: number;
}

async function get(url: string, timeoutMs: number, maxBytes: number): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  if (!res.ok) throw new ReleaseError(`The update server answered ${res.status} for ${new URL(url).pathname}.`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > maxBytes) throw new ReleaseError("The update server sent more than a manifest.");
  return body;
}

/** Fetches `<url>` and `<url>.sig`, and returns the release only if the signature holds. */
export async function fetchRelease(url: string, opts: FetchOptions): Promise<Release> {
  checkUrl(url, opts.allowHttp ?? false, "The update address");
  const timeout = opts.timeoutMs ?? 15_000;
  let body: Buffer;
  let sig: Buffer;
  try {
    [body, sig] = await Promise.all([
      get(url, timeout, 256 * 1024),
      get(`${url}.sig`, timeout, 1024),
    ]);
  } catch (err) {
    if (err instanceof ReleaseError) throw err;
    throw new ReleaseError(
      `Could not reach the update server (${(err as Error).message}). ` +
        "If this server has no internet access, update with the offline installer instead.",
    );
  }
  return verifyRelease(body, sig.toString("utf8"), opts.keys, { allowHttp: opts.allowHttp ?? false });
}

/**
 * Downloads a file and keeps it only if its size and SHA-256 match.
 *
 * The hash is computed while writing rather than afterwards, and a mismatch
 * deletes the file, so nothing unverified is ever left where an installer step
 * could pick it up.
 */
export async function downloadVerified(
  artifact: FileArtifact,
  dest: string,
  { allowHttp = false, timeoutMs = 30 * 60_000 } = {},
): Promise<void> {
  checkUrl(artifact.url, allowHttp, "The download");
  const res = await fetch(artifact.url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  if (!res.ok || !res.body) throw new ReleaseError(`The download failed with ${res.status}.`);

  const hash = createHash("sha256");
  const out = createWriteStream(dest, { mode: 0o600 });
  let size = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > artifact.size) throw new ReleaseError("The download is larger than the release says it is.");
      hash.update(value);
      if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    if (size !== artifact.size) throw new ReleaseError("The download is incomplete.");
    if (hash.digest("hex") !== artifact.sha256) {
      throw new ReleaseError("The download does not match the signed release. It has been deleted.");
    }
  } catch (err) {
    // Closed before deleting. A stream destroyed before it has finished
    // opening still creates the file once the open completes, so deleting
    // straight away could run first and leave an empty file behind - which is
    // what happens when the very first chunk is already too large.
    await new Promise<void>((resolve) => {
      if (out.closed) return resolve();
      out.once("close", () => resolve());
      out.destroy();
    });
    await rm(dest, { force: true });
    throw err;
  }
}
