import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { resolve } from "node:path";
import { releaseUrlFor } from "./update/release.js";

loadDotenv({ path: resolve(process.cwd(), "../../.env") });
loadDotenv(); // also allow a local .env inside apps/api

/**
 * The products this codebase builds.
 *
 * "abide" is HIPAA, and its pack lives in its own repository rather than in
 * packs/ here - the content is maintained separately, the engine is not.
 * See docs/dev/product-parity.md.
 */
export const PRODUCTS = ["ascend"] as const;
export type Product = (typeof PRODUCTS)[number];

/**
 * There is one edition and it is free. Named rather than assumed, so the
 * screens, the reports and the health endpoint all say the same word.
 */
/**
 * Empty on purpose.
 *
 * There is one edition, so naming it told a reader nothing and invited the
 * question it could not answer. Kept as a field rather than deleted, so a
 * second edition would be one string rather than a change to every pack and
 * every report footer.
 */
export const EDITION = "";

export const PRODUCT_META: Record<Product, { name: string; framework: string }> = {
  ascend: { name: "Offset Irtiqa", framework: "SAMA Cyber Security Framework" },
};

const hex32 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "must be 32 bytes of hex (64 chars)");

const schema = z.object({
  PRODUCT: z.enum(PRODUCTS).default("ascend"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  PORT: z.coerce.number().int().min(1).max(65535).default(8080),

  /**
   * Which network addresses to answer on.
   *
   * Loopback by default, which means only this machine. It used to be
   * 0.0.0.0, so a fresh install answered the whole office network over plain
   * HTTP and put passwords on the wire. Opening that up is now a deliberate
   * act that also requires either TLS or an explicit override.
   */
  HOST: z.string().default("127.0.0.1"),

  /** Both must be set to serve HTTPS directly. Paths to PEM files. */
  TLS_CERT_FILE: z.string().default(""),
  TLS_KEY_FILE: z.string().default(""),

  /**
   * Permission to answer the network without TLS of our own.
   *
   * The honest reason this exists: a reverse proxy terminating TLS in front
   * of us is a perfectly good arrangement, and refusing to start would make
   * the product unusable in the most common serious deployment. It is off by
   * default so nobody arrives there by accident.
   */
  ALLOW_INSECURE_NETWORK: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  PUBLIC_URL: z.string().url().default("http://localhost:8080"),

  // Path to the SQLite database file. A "file:" prefix is accepted and stripped.
  DATABASE_URL: z.string().min(1).default("file:./data/offset.db"),

  SESSION_SECRET: z.string().min(16),
  FIELD_ENC_KEY: z.string().min(16),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),

  // ── background worker ─────────────────────────────────────────────────────
  /** How often the worker looks for due work. */
  WORKER_POLL_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
  /** Local hour (0-23) for the daily jobs: the readiness snapshot and backup. */
  DAILY_JOB_HOUR: z.coerce.number().int().min(0).max(23).default(2),

  BACKUP_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  BACKUP_DIR: z.string().default("./backups"),

  /** Where uploaded evidence files are kept. Back this up as well as the
   *  database: the database records that a file exists, not its contents. */
  EVIDENCE_DIR: z.string().default("./evidence"),

  /**
   * Where the built web bundle is, when it is not in either usual place.
   *
   * Left unset the server looks beside itself at ../public, which is how an
   * installed copy and the container are laid out, and then at
   * dist/web/<product> for a development tree. Set this to serve a bundle from
   * somewhere else entirely.
   */
  WEB_DIR: z.string().optional(),
  /** Largest single upload. Enforced as the bytes arrive, not from a header. */
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(500).default(25),
  /** How many backups the folder keeps, of every kind together. Older ones are deleted. */
  BACKUP_KEEP: z.coerce.number().int().min(1).max(365).default(3),

  /**
   * Days of audit log to keep. Zero means keep everything, which is the
   * default: an audit trail is evidence, and silently deleting it is a
   * compliance decision the operator has to make deliberately.
   */
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(0),

  /**
   * Which callers may say who the real client is, with X-Forwarded-For.
   *
   * The address is written into the audit trail and is what the sign-in limits
   * count, so trusting the header from anyone would let anyone choose both.
   * "loopback" trusts a proxy on this same machine and nothing else, which is
   * right for every install that serves HTTPS itself. A proxy elsewhere is
   * named here: addresses, CIDR ranges, or "uniquelocal" when the application
   * can only be reached through the proxy, as in deploy/compose. "false"
   * trusts nobody; "true" trusts everybody and should never be needed.
   */
  TRUST_PROXY: z.string().trim().default("loopback"),

  // —— logs ——————————————————————————
  /** Folder for log files. A relative path is from the working directory. */
  LOG_DIR: z.string().default("./logs"),
  /**
   * Write logs to files as well as the console.
   *
   * "auto" means on in production and off in development, which is almost
   * always what is wanted: an installed copy has no console to read, and a
   * developer already has one.
   */
  LOG_TO_FILE: z.enum(["true", "false", "auto"]).default("auto"),
  /** Rotate a log once it passes this size. */
  LOG_MAX_MB: z.coerce.number().int().min(1).max(200).default(10),
  /** How many rotated generations to keep before the oldest is deleted. */
  LOG_KEEP: z.coerce.number().int().min(1).max(50).default(5),

  // —— updates ———————————————————————
  /**
   * How this copy was installed, which decides who can update it.
   *
   * Set by each installer. "none" - a portable zip, a source checkout, anything
   * without an updater beside it - means the Updates screen can say a newer
   * version exists but cannot install it.
   */
  INSTALL_KIND: z.enum(["docker", "linux", "windows", "none"]).default("none"),
  /** Where this application leaves a request for the updater. */
  UPDATE_REQUEST_DIR: z.string().default("./updates/request"),
  /**
   * Where the updater reports back. A separate folder from the request one,
   * and on a real install one this application can only read.
   */
  UPDATE_STATUS_DIR: z.string().default("./updates/status"),
  /**
   * The signed release manifest. A mirror may be named; it is verified all the
   * same. Left empty it follows the product, since each has its own page.
   */
  UPDATE_URL: z.string().url().or(z.literal("")).default(""),
  /**
   * Replaces the built-in signing keys, comma separated. For testing a release
   * pipeline only. It changes what this screen believes, never what an updater
   * will install: each updater takes its keys from somewhere this application
   * cannot write.
   */
  UPDATE_TRUSTED_KEYS: z.string().default(""),
  /** Accept plain HTTP for the manifest. Testing only. */
  UPDATE_ALLOW_HTTP: z.enum(["true", "false"]).default("false"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  // eslint-disable-next-line no-console
  console.error(`Invalid configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  // Worked out after parsing rather than as a default on the field: it depends
  // on PRODUCT, which is parsed at the same moment.
  UPDATE_URL: parsed.data.UPDATE_URL || releaseUrlFor(parsed.data.PRODUCT),
};
export const product = PRODUCT_META[config.PRODUCT];
export const isProd = config.NODE_ENV === "production";

/**
 * SAMA's maturity scale.
 *
 * Six levels, nought to five. Three is the floor SAMA expects a member
 * organisation to reach, which is why it is the default target rather than
 * five: a target nobody is asked to meet is not a target.
 */
export const MATURITY_MIN = 0;
export const MATURITY_MAX = 5;
export const MATURITY_DEFAULT_TARGET = 3;

/** True when HOST only answers this machine. */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  // A full IPv4 in 127.0.0.0/8, not merely something starting "127.": a host
  // named 127.example.com is a perfectly ordinary routable name, and treating
  // it as local would let an exposed install start with no certificate.
  return h === "localhost" || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h);
}


/** Resolved from LOG_TO_FILE, whose default depends on the environment. */
export const logToFile =
  config.LOG_TO_FILE === "auto" ? isProd : config.LOG_TO_FILE === "true";

/** Warn loudly if development placeholders reached production. */
if (isProd) {
  for (const key of ["SESSION_SECRET", "FIELD_ENC_KEY"] as const) {
    if (!hex32.safeParse(config[key]).success) {
      // eslint-disable-next-line no-console
      console.error(
        `${key} is not a 32-byte hex value. Generate one with:\n` +
          `  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
      );
      process.exit(1);
    }
  }
}
