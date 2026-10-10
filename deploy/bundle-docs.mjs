#!/usr/bin/env node
/**
 * Puts the customer documents into a bundle's docs/ folder.
 *
 *   node deploy/bundle-docs.mjs <out-dir>
 *
 * Used by all three builds (Windows, Linux, Docker), so a customer gets the
 * same documents whichever way they install, and they describe the
 * version in the box rather than whatever the website says today.
 *
 * The files are flattened into one folder, so their relative links are
 * rewritten to match: a link to another shipped document points at its new
 * name, a link to the licence points at the LICENSE.txt every bundle carries
 * beside docs/, and a link to anything that is not shipped (the developer
 * docs) keeps its words and loses the link. A dead link in a document handed
 * to a customer is worse than no link.
 *
 * Line endings are written as LF whatever the checkout used, because the
 * Linux and Docker bundles are read on Linux and every Windows editor copes.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where each document lives in the repository → its name in the bundle. */
export const DOCS = {
  "README.md": "README.md",
  "INSTALL.md": "INSTALL.md",
  "docs/technology.md": "technology.md",
  "docs/user-guide.md": "user-guide.md",
  // INSTALL.md sends administrators here twice, for mail settings and for
  // symptoms. Leaving it out would turn both into references to a guide they
  // do not have.
  "docs/ops/logs-and-troubleshooting.md": "logs-and-troubleshooting.md",
  // For the customer's security team and data protection officer, who read
  // the box before anybody installs it.
  "docs/security-overview.md": "security-overview.md",
  "docs/privacy.md": "privacy.md",
  "docs/security-questionnaire.md": "security-questionnaire.md",
  // What the product claims to do, in one page. A customer who installed
  // from the .exe could not read it without going to a repository they
  // have no access to.
  "docs/datasheets/offset-irtiqa.md": "datasheet.md",
};

/** Every bundle ships the licence as LICENSE.txt, one level above docs/. */
const LICENSE = { from: "LICENSE", to: "../LICENSE.txt" };

const LINK = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g;

/**
 * Rewrites the relative links in one document. Returns the new text and a
 * count of what happened, for the build log.
 */
export function rewriteLinks(text, source) {
  let kept = 0;
  let dropped = 0;
  const out = text.replace(LINK, (whole, bang, words, target) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return whole;
    const [path, anchor] = target.split("#", 2);
    const resolved = posix.normalize(posix.join(posix.dirname(source), path));
    const suffix = anchor === undefined ? "" : `#${anchor}`;
    if (resolved in DOCS) {
      kept++;
      return `${bang}[${words}](${DOCS[resolved]}${suffix})`;
    }
    if (resolved === LICENSE.from) {
      kept++;
      return `${bang}[${words}](${LICENSE.to})`;
    }
    dropped++;
    return words;
  });
  return { text: out, kept, dropped };
}

async function main() {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error("usage: node deploy/bundle-docs.mjs <out-dir>");
    process.exit(2);
  }
  await mkdir(outDir, { recursive: true });

  let kept = 0;
  let dropped = 0;
  for (const [from, to] of Object.entries(DOCS)) {
    const raw = (await readFile(join(repo, from), "utf8")).replace(/^﻿/, "").replace(/\r\n/g, "\n");
    const result = rewriteLinks(raw, from);
    kept += result.kept;
    dropped += result.dropped;
    await writeFile(join(outDir, to), result.text, "utf8");
  }
  console.log(
    `  docs: ${Object.keys(DOCS).length} documents, ${kept} links kept, ` +
      `${dropped} links to developer docs turned into plain text`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
