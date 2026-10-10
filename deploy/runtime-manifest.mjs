#!/usr/bin/env node
/**
 * Writes the package.json that the Windows and Linux bundles install from.
 *
 *   node deploy/runtime-manifest.mjs --version 0.2.0 --out <app folder>/package.json
 *
 * The bundles are installed with npm, not pnpm, because npm gives a flat tree
 * of real folders that survives being copied to another machine. But npm does
 * not read pnpm's lockfile, so given the ranges in apps/api/package.json it
 * installs whatever is newest on the day of the build - not what the tests
 * ran against.
 *
 * That went wrong on 2026-09-17. @fastify/static 10.1.4 came out that morning,
 * inside our "^10.1.3", and moved to content-disposition 3, which is ES
 * modules only. Node 20.11 cannot require() those, so a bundle built that day
 * crashed on start while the tests, the Docker image and every earlier bundle
 * were fine.
 *
 * So the versions come from pnpm's own resolution instead: every direct
 * dependency pinned exactly, and every package further down pinned through
 * npm "overrides" to the version pnpm installed. A package pnpm installs at
 * more than one version cannot be pinned by name alone, and is left to its
 * parent's range; there are a handful, all long-stable.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const out = arg("out");
if (!out) {
  console.error("Usage: node deploy/runtime-manifest.mjs --out <path/to/package.json> [--version x.y.z]");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(resolve(repo, "apps/api/package.json"), "utf8"));
const version = arg("version") || manifest.version;

// shell: true on Windows, where pnpm is a .cmd that execFile cannot start on its own.
const listed = JSON.parse(
  execFileSync("pnpm", ["--filter", "@offset/api", "list", "--prod", "--depth", "Infinity", "--json"], {
    cwd: repo,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  }),
);
const root = Array.isArray(listed) ? listed[0] : listed;
const direct = root?.dependencies ?? {};

const dependencies = {};
for (const name of Object.keys(manifest.dependencies)) {
  const found = direct[name]?.version;
  if (!found) throw new Error(`${name} is in apps/api/package.json but pnpm has not installed it. Run pnpm install.`);
  dependencies[name] = found;
}

const versions = new Map();
(function walk(deps) {
  for (const [name, info] of Object.entries(deps ?? {})) {
    if (!versions.has(name)) versions.set(name, new Set());
    versions.get(name).add(info.version);
    walk(info.dependencies);
  }
})(direct);

const overrides = {};
for (const [name, set] of [...versions].sort(([a], [b]) => a.localeCompare(b))) {
  // npm refuses an override that disagrees with a direct dependency, and a
  // direct dependency is already pinned above.
  if (name in dependencies || set.size !== 1) continue;
  overrides[name] = [...set][0];
}

const bundle = {
  name: manifest.name,
  version,
  private: true,
  type: manifest.type,
  main: manifest.main,
  dependencies,
  overrides,
};
writeFileSync(out, JSON.stringify(bundle, null, 2) + "\n");
console.log(
  `  pinned ${Object.keys(dependencies).length} dependencies and ${Object.keys(overrides).length} beneath them to the tested versions`,
);
