/**
 * The HTTPS certificate: where it comes from, checking one before it is used,
 * and putting a new one on the running server.
 *
 * Two places it can come from, in this order:
 *
 * 1. **Uploaded** on the Settings screen. Kept as one file, `certificate.json`,
 *    in a `tls` folder beside the database, so it is replaced in a single
 *    rename and a crash half way through cannot pair a new certificate with
 *    an old key.
 * 2. **Named in the settings file**, `TLS_CERT_FILE` and `TLS_KEY_FILE`. How
 *    every install did it before the upload existed, and still how an
 *    administrator who manages certificates with their own tools does it.
 *
 * The uploaded one wins. Otherwise uploading a replacement would work until
 * the next restart, and then the old file would quietly come back.
 *
 * The private key is not in any backup. Backups hold the database and the
 * evidence; this file sits beside them, not inside. Whoever issued the
 * certificate still has it, and a backup handed to somebody should not be a
 * way to impersonate the server.
 */
import { X509Certificate, createPrivateKey, type KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createSecureContext } from "node:tls";
import { config } from "../config.js";
import { decryptSecret, encryptSecret } from "../lib/secrets.js";

/** Beside the database, so it lives wherever the data does on every install. */
export const tlsDir = join(dirname(resolve(config.DATABASE_URL.replace(/^file:/, ""))), "tls");
const STORE = join(tlsDir, "certificate.json");

/** What Node's TLS takes: a PEM pair, or a PKCS#12 file and its password. */
export type TlsOptions = { key: Buffer; cert: Buffer } | { pfx: Buffer; passphrase: string };

export type TlsSource = "uploaded" | "settings";

/** What is on disk. The PFX password is encrypted, like the mail password. */
type Stored =
  | { format: "pem"; cert: string; key: string; uploadedAt: string; filenames: string[] }
  | { format: "pfx"; pfx: string; passphrase: string; uploadedAt: string; filenames: string[] };

export interface CertificateInfo {
  /** The name it was issued to (the CN). */
  subject: string;
  /** Every name and address a browser accepts it for. */
  names: string[];
  issuer: string;
  selfSigned: boolean;
  validFrom: string;
  validTo: string;
  daysLeft: number;
  /** SHA-256, as browsers show it, so it can be compared by eye. */
  fingerprint: string;
}

/** A refusal written for the person at the Settings screen. */
export class CertificateError extends Error {}

// —— loading ——————————————————————————————

export function hasUpload(): boolean {
  return existsSync(STORE);
}

function readStore(): Stored | null {
  if (!hasUpload()) return null;
  return JSON.parse(readFileSync(STORE, "utf8")) as Stored;
}

function optionsFrom(stored: Stored): TlsOptions {
  return stored.format === "pem"
    ? { cert: Buffer.from(stored.cert), key: Buffer.from(stored.key) }
    : { pfx: Buffer.from(stored.pfx, "base64"), passphrase: decryptSecret(stored.passphrase) };
}

/** True when the settings file names a certificate and a key. */
export function settingsFilesConfigured(): boolean {
  return config.TLS_CERT_FILE.trim() !== "" && config.TLS_KEY_FILE.trim() !== "";
}

function fromSettingsFiles(): TlsOptions {
  try {
    return { key: readFileSync(config.TLS_KEY_FILE), cert: readFileSync(config.TLS_CERT_FILE) };
  } catch (err) {
    // Naming the file beats "ENOENT", which sends people to the wrong one.
    throw new CertificateError(
      `Could not read the certificate or key named in the settings file.\n` +
        `  certificate: ${config.TLS_CERT_FILE}\n` +
        `  key:         ${config.TLS_KEY_FILE}\n\n` +
        `${(err as Error).message}`,
    );
  }
}

/**
 * The certificate to serve, or null for plain HTTP.
 *
 * Throws a `CertificateError` when one is configured but cannot be used, so
 * start-up can say which and stop, rather than falling back to HTTP and
 * sending passwords in clear on a server everyone believes is encrypted.
 */
export function loadTls(): { options: TlsOptions; source: TlsSource } | null {
  let stored: Stored | null;
  try {
    stored = readStore();
  } catch (err) {
    throw new CertificateError(`The uploaded certificate in ${STORE} is damaged: ${(err as Error).message}`);
  }
  if (stored) {
    try {
      return { options: optionsFrom(stored), source: "uploaded" };
    } catch {
      // Only the PFX password can fail here: it was encrypted with
      // FIELD_ENC_KEY, and that key has changed since.
      throw new CertificateError(
        `The password of the uploaded certificate cannot be read. FIELD_ENC_KEY in the\n` +
          `settings file has changed since it was uploaded. Put the old value back, or\n` +
          `delete ${STORE} and upload the certificate again.`,
      );
    }
  }
  if (settingsFilesConfigured()) return { options: fromSettingsFiles(), source: "settings" };
  return null;
}

// —— describing one ——————————————————————————

const DAY = 86_400_000;

/** The certificate a TLS context would actually present, PEM or PFX alike. */
function leafOf(options: TlsOptions): X509Certificate {
  const context = createSecureContext(options) as unknown as {
    context: { getCertificate(): Buffer | null };
  };
  const der = context.context.getCertificate();
  if (!der) throw new CertificateError("That file holds no certificate.");
  return new X509Certificate(der);
}

function field(dn: string, name: string): string {
  const line = dn.split("\n").find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1) : "";
}

function namesOf(cert: X509Certificate): string[] {
  return (cert.subjectAltName ?? "")
    .split(", ")
    .map((n) => n.replace(/^DNS:/, "").replace(/^IP Address:/, "").trim())
    .filter(Boolean);
}

export function describe(options: TlsOptions, now = Date.now()): CertificateInfo {
  const cert = leafOf(options);
  const validTo = new Date(cert.validTo);
  return {
    subject: field(cert.subject, "CN") || cert.subject.replace(/\n/g, ", "),
    names: namesOf(cert),
    issuer: field(cert.issuer, "CN") || field(cert.issuer, "O") || cert.issuer.replace(/\n/g, ", "),
    selfSigned: cert.subject === cert.issuer && cert.verify(cert.publicKey),
    validFrom: new Date(cert.validFrom).toISOString(),
    validTo: validTo.toISOString(),
    daysLeft: Math.floor((validTo.getTime() - now) / DAY),
    fingerprint: cert.fingerprint256,
  };
}

/** True when a browser would accept this certificate for `host`. */
export function covers(info: CertificateInfo, host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return info.names.some((n) => {
    const name = n.toLowerCase();
    if (name === h) return true;
    // *.example.com covers a.example.com, not example.com or a.b.example.com.
    return name.startsWith("*.") && h.endsWith(name.slice(1)) && !h.slice(0, -name.length + 1).includes(".");
  });
}

/**
 * What is worth telling somebody about a certificate that is otherwise fine.
 *
 * None of these stop it being used. A self-signed certificate is a step up
 * from no certificate, and a name mismatch may be deliberate while somebody
 * moves the server to its new name.
 */
export function warningsFor(info: CertificateInfo, publicHost: string): string[] {
  const out: string[] = [];
  if (info.daysLeft < 0) out.push("It has expired. Every browser will refuse it until it is replaced.");
  else if (info.daysLeft <= 30) out.push(`It expires in ${info.daysLeft} day${info.daysLeft === 1 ? "" : "s"}. Ask for a new one now.`);
  if (info.selfSigned) {
    out.push(
      "It is self-signed, so browsers will still say \"Not secure\" until it is trusted on each computer. " +
        "A certificate from your company's certificate authority avoids that.",
    );
  }
  if (!info.names.length) {
    out.push("It lists no names (no Subject Alternative Name). Current browsers reject a certificate like that.");
  } else if (publicHost && !covers(info, publicHost)) {
    out.push(
      `It is not issued for ${publicHost}, the address in PUBLIC_URL. It covers: ${info.names.join(", ")}. ` +
        "Browsers warn when the name people type is not on the certificate.",
    );
  }
  return out;
}

// —— checking an upload ——————————————————————

export interface UploadedFile {
  name: string;
  /** Base64 of the file exactly as chosen. PEM and PFX alike. */
  data: string;
}

const CERT_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const KEY_BLOCK = /-----BEGIN ((?:RSA |EC |ENCRYPTED )?PRIVATE KEY)-----[\s\S]+?-----END \1-----/g;

function readKey(pem: string, password: string): KeyObject {
  const encrypted = pem.includes("ENCRYPTED");
  if (encrypted && !password) {
    throw new CertificateError("The private key has a password. Type it in the password box and upload again.");
  }
  try {
    return createPrivateKey(encrypted ? { key: pem, passphrase: password } : pem);
  } catch {
    throw new CertificateError(
      encrypted ? "That password does not open the private key." : "The private key could not be read.",
    );
  }
}

function fromPem(texts: string[], password: string): TlsOptions {
  const all = texts.join("\n");
  const certs = [...new Set(all.match(CERT_BLOCK) ?? [])];
  const keys = [...all.matchAll(KEY_BLOCK)].map((m) => m[0]);

  if (!certs.length) throw new CertificateError("No certificate was found in those files.");
  if (!keys.length) {
    throw new CertificateError(
      "The private key is missing. It is a separate file, usually ending .key or named privkey.pem. " +
        "Choose it together with the certificate.",
    );
  }
  if (keys.length > 1) throw new CertificateError("Those files hold more than one private key. Choose only the one that belongs to this certificate.");

  const key = readKey(keys[0]!, password);
  const parsed = certs.map((pem) => {
    try {
      return { pem, x509: new X509Certificate(pem) };
    } catch {
      throw new CertificateError("One of the certificates in those files is damaged.");
    }
  });

  // The certificate that goes with the key must come first, then the chain.
  // People upload them in every order, and "fullchain" files differ on it.
  const leaf = parsed.find((c) => c.x509.checkPrivateKey(key));
  if (!leaf) throw new CertificateError("The private key does not belong to that certificate. They have to come from the same request.");
  const chain = parsed.filter((c) => c !== leaf).map((c) => c.pem);

  return {
    cert: Buffer.from([leaf.pem, ...chain].join("\n") + "\n"),
    // Stored without its password, because the server has to open it alone at
    // every start. It is protected by the folder it sits in, as the settings
    // file's own secrets are.
    key: Buffer.from(key.export({ type: "pkcs8", format: "pem" }) as string),
  };
}

function fromPfx(pfx: Buffer, password: string): TlsOptions {
  try {
    createSecureContext({ pfx, passphrase: password });
  } catch (err) {
    const msg = (err as Error).message;
    if (/mac verify|password|decrypt/i.test(msg)) {
      throw new CertificateError(
        password ? "That password does not open the .pfx file." : "The .pfx file has a password. Type it in the password box and upload again.",
      );
    }
    throw new CertificateError("That file is not a certificate this can read. Use a .pfx or .p12 file, or PEM files (.pem, .crt, .cer, .key).");
  }
  return { pfx, passphrase: password };
}

/**
 * Turns what somebody chose into something the server can use, or says
 * exactly why not.
 *
 * Accepts what people are actually given: a certificate and key as two PEM
 * files, both in one file, Let's Encrypt's `fullchain.pem` and `privkey.pem`,
 * or a `.pfx` exported from Windows with its password.
 */
export function prepareUpload(files: UploadedFile[], password: string, now = Date.now()): { options: TlsOptions; info: CertificateInfo } {
  if (!files.length) throw new CertificateError("Choose the certificate file first.");
  const raw = files.map((f) => Buffer.from(f.data, "base64"));
  const isPem = raw.map((b) => b.toString("latin1").includes("-----BEGIN "));

  let options: TlsOptions;
  if (isPem.every(Boolean)) {
    options = fromPem(raw.map((b) => b.toString("utf8")), password);
  } else if (raw.length === 1) {
    options = fromPfx(raw[0]!, password);
  } else {
    throw new CertificateError("A .pfx file already holds the certificate and its key. Choose it on its own.");
  }

  let info: CertificateInfo;
  try {
    info = describe(options, now);
  } catch (err) {
    if (err instanceof CertificateError) throw err;
    if (/key too small/i.test((err as Error).message)) {
      throw new CertificateError("Its key is too weak. Browsers refuse anything under 2048 bits. Ask for a new certificate.");
    }
    throw new CertificateError(`The certificate and key cannot be used together: ${(err as Error).message}`);
  }

  if (info.daysLeft < 0) throw new CertificateError(`That certificate expired on ${info.validTo.slice(0, 10)}.`);
  if (Date.parse(info.validFrom) > now) throw new CertificateError(`That certificate is not valid until ${info.validFrom.slice(0, 10)}.`);
  const bits = leafOf(options).publicKey.asymmetricKeyDetails?.modulusLength;
  if (bits !== undefined && bits < 2048) {
    throw new CertificateError(`Its key is ${bits}-bit. Browsers refuse anything under 2048. Ask for a new certificate.`);
  }
  return { options, info };
}

// —— saving ——————————————————————————————

export function saveUpload(options: TlsOptions, filenames: string[]): void {
  const stored: Stored =
    "pfx" in options
      ? {
          format: "pfx",
          pfx: options.pfx.toString("base64"),
          passphrase: encryptSecret(options.passphrase),
          uploadedAt: new Date().toISOString(),
          filenames,
        }
      : {
          format: "pem",
          cert: options.cert.toString(),
          key: options.key.toString(),
          uploadedAt: new Date().toISOString(),
          filenames,
        };
  mkdirSync(tlsDir, { recursive: true, mode: 0o700 });
  const next = `${STORE}.next`;
  writeFileSync(next, JSON.stringify(stored), { mode: 0o600 });
  renameSync(next, STORE);
}

export function removeUpload(): void {
  rmSync(STORE, { force: true });
}

export function uploadDetails(): { uploadedAt: string; filenames: string[] } | null {
  try {
    const s = readStore();
    return s ? { uploadedAt: s.uploadedAt, filenames: s.filenames } : null;
  } catch {
    return null;
  }
}
