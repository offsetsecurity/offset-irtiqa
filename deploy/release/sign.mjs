#!/usr/bin/env node
/**
 * Signs a release manifest.
 *
 *   RELEASE_SIGNING_KEY="$(cat key.pem)" node deploy/release/sign.mjs release.json
 *
 * Writes release.json.sig: a base64 Ed25519 signature over the file's exact
 * bytes. Nothing may touch release.json after this runs, not even a newline
 * added by an editor, or every install will rightly refuse it.
 *
 * The key is read from the environment, not from a path, so in CI it goes from
 * the secret straight into this process and never onto the runner's disk.
 */
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const manifest = process.argv[2];
const pem = process.env.RELEASE_SIGNING_KEY;
if (!manifest || !pem) {
  console.error("Usage: RELEASE_SIGNING_KEY=<pem> node deploy/release/sign.mjs <release.json>");
  process.exit(1);
}

const key = createPrivateKey(pem);
if (key.asymmetricKeyType !== "ed25519") {
  console.error("RELEASE_SIGNING_KEY is not an Ed25519 private key.");
  process.exit(1);
}

const body = readFileSync(manifest);
const signature = sign(null, body, key);

// Check our own work before publishing it.
if (!verify(null, body, createPublicKey(key), signature)) {
  console.error("The signature does not verify against its own key. Not writing it.");
  process.exit(1);
}

writeFileSync(`${manifest}.sig`, signature.toString("base64"));
console.log(`Signed ${manifest} with key ${createPublicKey(key).export({ format: "jwk" }).x}`);
