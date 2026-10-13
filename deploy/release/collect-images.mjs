/**
 * Gathers the image digests the build recorded into one file.
 *
 *     node deploy/release/collect-images.mjs dist/release images.json
 *
 * Each product's Docker job writes images-<product>.json naming the image and
 * the digest the registry returned. The manifest builder wants them in one
 * object, and the release pages must not carry these files themselves - they
 * are build plumbing, not something a customer downloads - so they are removed
 * once read.
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error("usage: collect-images.mjs <files-dir> <out-file>");
  process.exit(1);
}

const all = {};
let found = 0;

for (const name of readdirSync(dir).filter((n) => /^images-.*\.json$/.test(n))) {
  Object.assign(all, JSON.parse(readFileSync(join(dir, name), "utf8")));
  rmSync(join(dir, name));
  found++;
}

writeFileSync(out, JSON.stringify(all));
console.log(`${found} image file(s) read: ${Object.keys(all).join(", ") || "none"}`);
