/**
 * Windows launcher.
 *
 * Starts the API and the background worker as one process tree, so closing
 * the window or pressing Ctrl+C stops both. Running them from two shortcuts
 * leaves orphans, and an orphaned worker still holding the database is a
 * confusing thing to debug on someone else's machine.
 *
 * Also does first-run setup: without secrets the API refuses to start, and
 * asking a customer to generate 32 bytes of hex by hand is not a first
 * impression worth having.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import {
  existsSync, writeFileSync, readFileSync, mkdirSync, appendFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The bundle ships as ES modules, because the app package is one.
const appDir = dirname(fileURLToPath(import.meta.url));

/**
 * Where the database, backups and .env live.
 *
 * Beside the app for the portable zip, which is what someone unzipping it
 * expects. The installer sets OFFSET_DATA_DIR to somewhere under ProgramData,
 * because Program Files is read-only for normal users and an app that cannot
 * write its own database is not installed, it is merely present.
 */
function dataDirFromArgs() {
  const i = process.argv.indexOf("--data-dir");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : "";
}

/**
 * Three ways to say where the data lives, most explicit first.
 *
 * The argument exists for the Windows service. A scheduled task cannot set an
 * environment variable for its action, and an installed copy cannot fall back
 * to sitting beside the application because Program Files is read-only.
 */
const root = resolve(
  dataDirFromArgs() || process.env.OFFSET_DATA_DIR || resolve(appDir, ".."),
);
const envFile = join(root, ".env");
const logsDir = join(root, "logs");

/**
 * The launcher's own log.
 *
 * Separate from the application logs on purpose: it records the things that
 * happen before the application can log anything, which is exactly the window
 * where a bad install fails. If the API dies on a malformed .env it prints to
 * stderr and exits before its logger exists, so without this the only copy of
 * the reason is in a console window that is about to close.
 */
function note(text) {
  try {
    mkdirSync(logsDir, { recursive: true });
    appendFileSync(join(logsDir, "launcher.log"), `${new Date().toISOString()} ${text}\n`);
  } catch {
    /* never let logging stop the launcher */
  }
}

function firstRun() {
  if (existsSync(envFile)) return false;

  const template = join(appDir, "env.template");
  const body = existsSync(template) ? readFileSync(template, "utf8") : "";
  const filled = body
    .replace("SESSION_SECRET=", `SESSION_SECRET=${randomBytes(32).toString("hex")}`)
    .replace("FIELD_ENC_KEY=", `FIELD_ENC_KEY=${randomBytes(32).toString("hex")}`);

  mkdirSync(root, { recursive: true });
  // "wx": never replace a settings file that appeared since the check above;
  // it holds the keys the database was encrypted with.
  try {
    writeFileSync(envFile, filled, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if (err?.code === "EEXIST") return false;
    throw err;
  }
  for (const dir of ["data", "backups", "evidence", "logs"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  return true;
}

let created = false;
try {
  created = firstRun();
} catch (err) {
  note(`FATAL first-run setup failed: ${err?.stack || err}`);
  console.error("Could not create the settings file:", err?.message || err);
  process.exit(1);
}


note(
  `launcher starting — node ${process.version}, data ${root}` +
    (created ? " (first run: created .env and folders)" : ""),
);

// dotenv in the API reads .env from the working directory, so run from the
// bundle root rather than from app\.
process.chdir(root);

/**
 * One-click updates, for a copy the installer put in place.
 *
 * The installer writes install.json beside node.exe; the portable zip has
 * none, and cannot update itself. Set here rather than in .env because the
 * paths depend on where Windows keeps ProgramData, and because dotenv never
 * overrides what is already in the environment, so these always win.
 */
if (existsSync(resolve(appDir, "..", "install.json"))) {
  let display = "";
  try {
    // replace() strips a byte-order mark: PowerShell wrote one into
    // product.json for a while, and JSON.parse refuses a file that starts
    // with it. An install from that period would otherwise never update.
    const meta = readFileSync(join(appDir, "product.json"), "utf8").replace(/^﻿/, "");
    display = JSON.parse(meta).display ?? "";
  } catch {
    /* no updates without knowing which product this is */
  }
  if (/^Offset [A-Za-z]+$/.test(display)) {
    const programData = process.env.ProgramData || "C:\\ProgramData";
    process.env.INSTALL_KIND = "windows";
    process.env.UPDATE_REQUEST_DIR = join(root, "updates", "request");
    process.env.UPDATE_STATUS_DIR = join(programData, "Offset Security", `${display} updater`, "status");
  }
}

/** No console: set by the Windows service, which has nowhere to print. */
const headless = process.argv.includes("--service");

const children = [];
let stopping = false;

function run(label, script) {
  const child = spawn(process.execPath, [join(appDir, "dist", script)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    // Without this each half of the product gets a black console window of
    // its own. The launcher that starts this file has no console - it is
    // started detached and hidden, so nobody can close it and kill the
    // product - and Windows gives a program with no console parent a brand
    // new visible one. Two windows, "node.exe", on every start, and closing
    // either took the product down. The output is piped, so nothing is lost.
    windowsHide: true,
  });

  const write = (stream, chunk, alsoNote) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      // As a service there is no console, and the handle we would write
      // to is not a real one. The children already write their own log
      // files, so this would be output nobody can read, down a pipe
      // nobody drains.
      if (!headless) stream.write(`[${label}] ${line}\n`);
      // Only stderr is copied here. stdout is already in the application's
      // own log file, and duplicating it would make launcher.log useless as
      // the short file you ask a customer to send first.
      if (alsoNote) note(`[${label}] ${line}`);
    }
  };
  child.stdout.on("data", (c) => write(process.stdout, c, false));
  child.stderr.on("data", (c) => write(process.stderr, c, true));

  child.on("exit", (code) => {
    note(`${label} exited with code ${code}`);
    if (stopping) return;
    // If either half dies, take the other down too rather than limping along
    // with, say, a running API and no backups.
    if (!headless) {
      process.stdout.write(`\n[${label}] stopped unexpectedly (exit ${code}). Shutting down.\n`);
    }
    stop(code ?? 1);
  });

  children.push(child);
  return child;
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 500);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    note(`stopping on ${signal}`);
    if (!headless) process.stdout.write("\nStopping…\n");
    stop(0);
  });
}

/**
 * The port the API will actually listen on.
 *
 * Read from the same .env the children read, not from our own environment.
 * The launcher does not load .env — dotenv runs inside each child — so relying
 * on process.env here printed the default while the application was on
 * whatever .env said. Sending somebody to the wrong port is worse than saying
 * nothing, because on a busy machine something else may answer there.
 */
function settingFromEnvFile(name) {
  try {
    const lines = readFileSync(envFile, "utf8")
      .split(/\r?\n/)
      .filter((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
    // The last one, because that is the one dotenv uses: it assigns as it
    // reads, so a later line overwrites an earlier one. Taking the first
    // meant that a file with two PORT lines printed one number here and
    // listened on the other, which is a miserable thing to debug.
    const line = lines[lines.length - 1];
    const value = line ? line.slice(line.indexOf("=") + 1).trim() : "";
    if (value) return value;
  } catch {
    /* no .env yet, or unreadable: fall through */
  }
  return "";
}

function configuredPort() {
  const value = settingFromEnvFile("PORT");
  if (/^\d+$/.test(value)) return value;
  return process.env.PORT || "8080";
}

/**
 * Is somebody else already on our port?
 *
 * The API finds this out too, but it finds out by throwing EADDRINUSE with a
 * Node stack trace into a log file five folders deep, and then the window
 * closes. From the Start menu that looks like nothing happening at all.
 *
 * Retried, because an update restarts the application and Windows can hold a
 * closing socket for a moment. Failing on that would turn every update into a
 * support call.
 */
function portHolder(port, host) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once("error", (err) => done(err.code === "EADDRINUSE"));
    probe.once("listening", () => probe.close(() => done(false)));
    probe.listen(Number(port), host);
  });
}

async function portIsTaken(port, host) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!(await portHolder(port, host))) return false;
    if (attempt < 4) await new Promise((r) => setTimeout(r, 1000));
  }
  return true;
}

const port = configuredPort();
const host = settingFromEnvFile("HOST") || "127.0.0.1";

if (await portIsTaken(port, host)) {
  const message =
    `Port ${port} is already in use, so the application cannot start.`;
  note(`FATAL ${message}`);
  if (!headless) {
    console.log("");
    console.log(`  ${message}`);
    console.log("");
    console.log("  Something else on this machine is listening there — another");
    console.log("  Offset product, or your own server.");
    console.log("");
    console.log(`  To move this one, open  ${envFile}`);
    console.log("  change the PORT= line, and start it again.");
    console.log("");
  }
  process.exit(1);
}

// As a service there is no console to write to, and everything below is
// already in launcher.log. Printing it would only fill a pipe nobody reads.
if (!headless) {
  console.log("");
  console.log("  Offset Security");
  console.log("  ---------------");
  if (created) {
    console.log(`  First run: created settings and data in ${root}`);
  }
  console.log(`  Opening on http://localhost:${port}`);
  console.log("  Leave this window open. Press Ctrl+C to stop.");
  console.log(`  Logs: ${logsDir}`);
  console.log("");
}

run("app", "server.js");
run("jobs", "worker.js");
