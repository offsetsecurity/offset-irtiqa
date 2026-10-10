#!/usr/bin/env node
/**
 * Creates the release signing key.
 *
 *   node deploy/release/keygen.mjs <where-to-save-the-private-key.pem>
 *
 * Writes the private key to that file and prints only the public key, which
 * goes into TRUSTED_KEYS in apps/api/src/update/release.ts.
 *
 * The private key is the one thing that can make an update install itself on
 * every customer's server. It belongs in two places only: the release
 * workflow's secrets on GitHub, and a backup you control. Never in this
 * repository, never in a chat, never on a shared drive. Lose it and you rotate
 * to a new key; leak it and anyone can ship an "update".
 *
 * Refuses to overwrite an existing file, because overwriting a signing key by
 * accident silently breaks every future release.
 */
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node deploy/release/keygen.mjs <private-key-file.pem>");
  process.exit(1);
}
const file = resolve(target);
if (existsSync(file)) {
  console.error(`${file} already exists. Refusing to overwrite a signing key.`);
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });

const raw = publicKey.export({ format: "jwk" }).x;
console.log(`Private key written to ${file}`);
console.log("");
console.log("Public key, for TRUSTED_KEYS in apps/api/src/update/release.ts:");
console.log(raw);
