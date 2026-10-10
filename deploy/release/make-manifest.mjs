#!/usr/bin/env node
/**
 * Writes release.json from what the release workflow built.
 *
 *   node deploy/release/make-manifest.mjs \
 *     --version 0.2.0 \
 *     --base-url https://github.com/offsetsecurity/grc-suite-releases/releases/download/v0.2.0 \
 *     --files dist/release \
 *     --images images.json \
 *     --notes notes.md \
 *     --out dist/release/release.json
 *
 * `--files` holds the Linux tarballs and Windows installers. Their SHA-256 and
 * size are measured here from the files themselves, never taken from anything
 * a build step claimed, so the manifest describes exactly what is uploaded.
 *
 * `--images` is {"ascend": {"image": ..., "digest": ..., "updaterImage": ...,
 * "updaterDigest": ...}} as reported by the registry push.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];

for (const required of ["version", "base-url", "files", "out"]) {
  if (!args[required]) {
    console.error(`Missing --${required}`);
    process.exit(1);
  }
}
if (!/^\d+\.\d+\.\d+$/.test(args.version)) {
  console.error(`--version must be x.y.z, not ${args.version}`);
  process.exit(1);
}

/** Folder names for the Windows installers, as build.ps1 and offset.iss name them. */
const WINDOWS_NAME = { ascend: "OffsetIrtiqa" };

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const artifact = (name) => {
  const path = join(args.files, name);
  if (!existsSync(path)) return undefined;
  return {
    url: `${args["base-url"]}/${encodeURIComponent(name)}`,
    sha256: sha256(path),
    size: statSync(path).size,
  };
};

const images = args.images ? JSON.parse(readFileSync(args.images, "utf8")) : {};
const present = readdirSync(args.files);
const products = {};

// --only narrows the manifest to one product. Each product has its own
// releases page, and a manifest that named all five would send an install
// looking for files that are not on the page it is reading.
const ids = args.only ? [args.only] : Object.keys(WINDOWS_NAME);
if (args.only && !WINDOWS_NAME[args.only]) {
  console.error(`--only ${args.only} is not a product`);
  process.exit(1);
}

for (const id of ids) {
  const entry = {};
  const linux = artifact(`offset-${id}-${args.version}-linux-x64.tar.gz`);
  const windows = artifact(`${WINDOWS_NAME[id]}-${args.version}-setup.exe`);
  if (linux) entry.linux = linux;
  if (windows) entry.windows = windows;
  if (images[id]) entry.docker = images[id];
  if (Object.keys(entry).length) products[id] = entry;
}

if (Object.keys(products).length === 0) {
  console.error(`Nothing to release: no recognised files in ${args.files} (found: ${present.join(", ")}).`);
  process.exit(1);
}

const release = {
  schema: 1,
  version: args.version,
  published: new Date().toISOString(),
  notes: args.notes && existsSync(args.notes) ? readFileSync(args.notes, "utf8").trim() : "",
  products,
};

writeFileSync(args.out, JSON.stringify(release, null, 2) + "\n");
for (const [id, p] of Object.entries(products)) {
  console.log(`${id}: ${Object.keys(p).join(", ")}`);
}
console.log(`Wrote ${args.out}`);
