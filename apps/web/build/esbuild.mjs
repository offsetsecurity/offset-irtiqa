import * as esbuild from "esbuild";
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const PRODUCT = process.env.PRODUCT ?? "align";

/**
 * One folder per product.
 *
 * Every product is built from this one source tree with a different pack baked
 * in, so a shared output folder means the last build wins and the others are
 * silently gone. That is not theoretical: building Ascend once left a running
 * Align server serving Ascend's branding and a navigation item its own API had
 * no route for, which the browser reported as a version mismatch. The server
 * was fine. The folder underneath it had been replaced.
 *
 * Naming the folder after the product makes that impossible, and makes it
 * obvious on disk which products have been built.
 */
const outDir = resolve(root, `../../dist/web/${PRODUCT}`);
const watch = process.argv.includes("--watch");

/** The pack is baked in at build time — that is what makes one codebase three products. */
const packDir = resolve(root, `../../packs/${PRODUCT}`);

async function loadPack() {
  const read = async (f) => JSON.parse(await readFile(join(packDir, f), "utf8"));
  const [pack, themes, controls, guide] = await Promise.all([
    read("pack.json"),
    read("themes.json"),
    read("controls.json"),
    read("guide.json"),
  ]);
  return { pack, themes, controls, guide };
}

async function build() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const { pack } = await loadPack();

  const result = await esbuild.build({
    entryPoints: [resolve(root, "src/core/main.ts")],
    bundle: true,
    format: "esm",
    target: ["es2022"],
    minify: !watch,
    sourcemap: watch ? "inline" : true,
    outdir: outDir,
    entryNames: watch ? "app" : "app.[hash]",
    metafile: true,
    define: {
      "import.meta.env.PRODUCT": JSON.stringify(PRODUCT),
      "import.meta.env.PRODUCT_NAME": JSON.stringify(pack.product),
      "import.meta.env.EDITION": JSON.stringify(pack.edition),
      "import.meta.env.FRAMEWORK": JSON.stringify(pack.framework),
      "import.meta.env.DEV": JSON.stringify(watch),
    },
    loader: { ".svg": "text", ".json": "json" },
    logLevel: "info",
  });

  // Find the hashed bundle name so index.html can point at it.
  const jsFile =
    Object.keys(result.metafile.outputs)
      .map((p) => p.split(/[\\/]/).pop())
      .find((f) => f?.endsWith(".js")) ?? "app.js";

  const template = await readFile(resolve(root, "src/core/index.html"), "utf8");
  const html = template
    .replaceAll("{{BUNDLE}}", jsFile)
    .replaceAll("{{PRODUCT_NAME}}", pack.product)
    .replaceAll("{{EDITION}}", pack.edition)
    .replaceAll("{{FRAMEWORK_SHORT}}", pack.frameworkShort)
    .replaceAll("{{FRAMEWORK}}", pack.framework);
  await writeFile(join(outDir, "index.html"), html);

  // Static assets: brand marks, icons, and the pack the SPA fetches at runtime.
  await cp(resolve(root, "src/assets"), join(outDir, "assets"), { recursive: true });
  await cp(packDir, join(outDir, "pack"), { recursive: true });

  const bytes = Buffer.byteLength(await readFile(join(outDir, jsFile)));
  const sha = createHash("sha256").update(await readFile(join(outDir, jsFile))).digest("hex");
  console.log(
    `built ${pack.product} → ${jsFile} (${(bytes / 1024).toFixed(1)} KB, sha256 ${sha.slice(0, 12)}…)`,
  );
}

if (watch) {
  const ctx = await esbuild.context({
    entryPoints: [resolve(root, "src/core/main.ts")],
    bundle: true,
    format: "esm",
    outdir: outDir,
    sourcemap: "inline",
    logLevel: "info",
  });
  await build();
  await ctx.watch();
  console.log("watching for changes…");
} else {
  await build();
}
