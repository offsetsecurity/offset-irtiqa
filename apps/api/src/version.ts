import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Which version this copy of the product is.
 *
 * The update check compares against this, so it has to be right on every kind
 * of install, and each kind knows it a different way:
 *
 *   Docker    OFFSET_VERSION, baked into the image when it is built
 *   Linux     the version in the bundle's package.json, set by build.sh
 *   Windows   the same, set by build.ps1
 *   source    apps/api/package.json
 *
 * Deliberately not read through config.ts. The updaters need it too, and they
 * must not load the application's configuration.
 *
 * OFFSET_VERSION, not APP_VERSION. A Docker install's .env names APP_VERSION to
 * pick the image tag, and compose passes .env into the container, so reading
 * APP_VERSION here made every updated container report the version it was
 * installed at - and the updater, seeing the old number, rolled every update
 * back. The name the image bakes in must be one .env never uses.
 */
const SEMVER = /^\d+\.\d+\.\d+$/;

export function readVersion(appRoot?: string): string {
  const fromEnv = process.env["OFFSET_VERSION"];
  if (!appRoot && fromEnv && SEMVER.test(fromEnv)) return fromEnv;

  const root = appRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const v = (JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version?: unknown }).version;
    if (typeof v === "string" && SEMVER.test(v)) return v;
  } catch {
    /* fall through */
  }
  return "0.0.0";
}

export const APP_VERSION = readVersion();
