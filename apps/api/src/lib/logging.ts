/**
 * Log files.
 *
 * Once this is installed on someone else's machine the console is not enough:
 * the window gets closed, and every line that would have explained what went
 * wrong goes with it. So everything is written to a file as well — one that
 * survives a restart, rotates before it fills a disk, and is small enough to
 * attach to an email.
 *
 * Writes are synchronous on purpose. This product already chose a synchronous
 * database for the same reason: a few hundred lines a day costs nothing, and a
 * buffered log drops precisely the lines that matter — the ones written while
 * the process was dying.
 */
import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import pino from "pino";
import { config, logToFile } from "../config.js";

/** Absolute path of the folder holding the log files. */
export function logDir(): string {
  return resolve(process.cwd(), config.LOG_DIR);
}

/**
 * Fields that must never reach a log file.
 *
 * A log is the one artefact a customer is asked to email to a stranger when
 * something breaks, so it has to be safe to send. Shared by the API and the
 * worker so neither can drift into leaking something the other redacts.
 */
export const REDACT = [
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
  "body.password",
  "body.currentPassword",
  "*.password",
  "*.password_hash",
  "*.SESSION_SECRET",
  "*.FIELD_ENC_KEY",
  "*.secret",
  "*.token",
];

/** Overrides, so the rotation can be tested without writing megabytes. */
export interface SinkOptions {
  dir?: string;
  maxBytes?: number;
  keep?: number;
}

/** The minimum pino needs from a destination. */
export interface LogSink {
  write(line: string): void;
}

/**
 * Appends to `<name>.log`, rotating to `<name>.log.1` … `<name>.log.N`.
 *
 * The size is tracked in memory rather than stat()ed on every line. It is read
 * from disk when the file is first opened and reset on rotation, which are the
 * only moments it could be wrong by more than this process's own writes.
 */
export function fileSink(name: string, opts: SinkOptions = {}): LogSink {
  const dir = opts.dir ?? logDir();
  const file = join(dir, `${name}.log`);
  const maxBytes = opts.maxBytes ?? config.LOG_MAX_MB * 1024 * 1024;
  const keep = opts.keep ?? config.LOG_KEEP;

  let size = 0;
  let opened = false;

  const open = (): void => {
    mkdirSync(dir, { recursive: true });
    try {
      size = statSync(file).size;
    } catch {
      size = 0; // not written yet
    }
    opened = true;
  };

  const rotate = (): void => {
    try {
      unlinkSync(`${file}.${keep}`);
    } catch {
      /* the oldest generation does not exist yet */
    }
    for (let i = keep - 1; i >= 1; i--) {
      try {
        renameSync(`${file}.${i}`, `${file}.${i + 1}`);
      } catch {
        /* that generation does not exist yet */
      }
    }
    try {
      renameSync(file, `${file}.1`);
    } catch {
      /* nothing to rotate */
    }
    size = 0;
  };

  return {
    write(line: string): void {
      const text = line.endsWith("\n") ? line : `${line}\n`;
      try {
        if (!opened) open();
        if (size + text.length > maxBytes) rotate();
        appendFileSync(file, text);
        size += text.length;
      } catch {
        // Logging must never be the thing that takes the application down.
        // A full disk should lose the log, not the product.
      }
    },
  };
}

/**
 * A logger that writes to the console and, when file logging is on, to
 * `<name>.log` as well.
 *
 * `name` appears on every line, so a support engineer looking at two files
 * side by side can tell which process said what.
 */
// Typed as Fastify's logger rather than pino's own: pino satisfies it, and it
// keeps buildApp returning a plain FastifyInstance instead of one narrowed to
// a pino-specific generic that every caller would then have to repeat.
export function buildLogger(name: string): FastifyBaseLogger {
  const level = config.LOG_LEVEL;
  const streams: pino.StreamEntry[] = [{ level, stream: process.stdout }];

  if (logToFile) {
    // pino only calls .write(), which is all fileSink provides. The cast says
    // so rather than pretending to implement the rest of a WritableStream.
    streams.push({ level, stream: fileSink(name) as unknown as NodeJS.WritableStream });
  }

  return pino({ level, redact: REDACT, base: { name } }, pino.multistream(streams));
}

/**
 * Records anything that would otherwise kill the process silently.
 *
 * Crashes go to `crash.log` as well as the normal log. "Send me crash.log" is
 * a question a customer can answer; "find the stack trace in app.log" is not.
 */
export function recordCrash(name: string, kind: string, err: unknown, log?: FastifyBaseLogger): void {
  const detail =
    err instanceof Error
      ? { message: err.message, stack: err.stack }
      : { message: String(err) };

  fileSink("crash").write(
    JSON.stringify({
      time: new Date().toISOString(),
      process: name,
      kind,
      ...detail,
    }),
  );

  try {
    log?.fatal({ kind, err: detail }, `${kind} — ${name} is stopping`);
  } catch {
    /* the logger itself may be the thing that broke */
  }
}

export function captureCrashes(log: FastifyBaseLogger, name: string): void {
  let handled = false;
  const record = (kind: string, err: unknown): void => recordCrash(name, kind, err, log);

  process.on("uncaughtException", (err) => {
    if (handled) return;
    handled = true;
    record("uncaughtException", err);
    // Node's own default is to exit here. Carrying on with unknown state would
    // corrupt something quietly instead of loudly.
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    if (handled) return;
    handled = true;
    record("unhandledRejection", reason);
    process.exit(1);
  });
}

/**
 * The facts a support engineer asks for first, written once at start-up.
 *
 * Cheap to log and it removes an entire round trip of questions: which
 * product, which version, where is the database, which Node.
 */
export function logStartupContext(log: FastifyBaseLogger, extra: Record<string, unknown> = {}): void {
  log.info(
    {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      pid: process.pid,
      cwd: process.cwd(),
      logDir: logDir(),
      database: config.DATABASE_URL,
      logToFile,
      ...extra,
    },
    "start-up context",
  );
}
