import { cpSync, mkdirSync, readdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `tsc` only emits JavaScript, so anything that is not code has to be copied
 * here or the built server dies looking for it.
 *
 *  - .sql migrations, which the migration runner reads at boot
 *  - the brand logo, which the PDF reports draw in their header
 *
 * The logo is copied from the web package rather than duplicated, so there is
 * one file to change if the mark ever changes.
 */
const api = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const from = resolve(api, "src/db/migrations");
const to = resolve(api, "dist/db/migrations");
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });

const migrations = readdirSync(to).filter((f) => f.endsWith(".sql")).length;
if (migrations === 0) throw new Error(`No migrations copied from ${from} — the build is broken.`);

const logoSource = resolve(api, "../web/src/assets/brand/logo-light-notagline.svg");
const brandDir = resolve(api, "dist/brand");
mkdirSync(brandDir, { recursive: true });
if (!existsSync(logoSource)) throw new Error(`Brand logo missing at ${logoSource}.`);
copyFileSync(logoSource, resolve(brandDir, "logo.svg"));

console.log(`copied ${migrations} migration(s) and the brand logo into dist`);
