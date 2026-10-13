/**
 * What the shortcut runs: opens the product in a browser.
 *
 * The shortcut used to run the launcher, so double-clicking it opened a
 * console window and nothing else. The person then had to read the port out
 * of that window and type the address themselves, and closing the window they
 * did not understand stopped the product. That is not an application, it is a
 * homework assignment.
 *
 * So: if it is already running - as the background service, or in a window
 * somebody left open - this just opens the browser. If it is not, it starts
 * it, waits for it to answer, and then opens the browser. Either way the
 * person double-clicks one thing and ends up looking at the product.
 */
import { spawn } from "node:child_process";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

/** The installed name, for finding the data folder. */
function productDisplay() {
  try {
    // replace() strips a byte-order mark, which PowerShell wrote into
    // product.json for a while and JSON.parse refuses.
    const meta = readFileSync(join(appDir, "product.json"), "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(meta).display ?? "";
  } catch {
    return "";
  }
}

/**
 * Where .env lives: under ProgramData for an installed copy, beside the
 * application for the portable zip, and whatever OFFSET_DATA_DIR says if
 * somebody has moved it.
 */
function dataDir() {
  if (process.env.OFFSET_DATA_DIR) return process.env.OFFSET_DATA_DIR;
  const display = productDisplay();
  if (display && existsSync(resolve(appDir, "..", "install.json"))) {
    const programData = process.env.ProgramData || "C:\\ProgramData";
    return join(programData, "Offset Security", display);
  }
  return resolve(appDir, "..");
}

const root = dataDir();
const envFile = join(root, ".env");

function setting(name) {
  try {
    const lines = readFileSync(envFile, "utf8")
      .split(/\r?\n/)
      .filter((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
    // The last, because that is the one dotenv hands the application.
    const line = lines[lines.length - 1];
    return line ? line.slice(line.indexOf("=") + 1).trim() : "";
  } catch {
    return "";
  }
}

/**
 * The port, from .env when this person may read it. Ordinary users may not:
 * the data folder holds the encryption keys and is closed to them. So the
 * installer also writes the port, which is not a secret, into install.json.
 */
function installedPort() {
  try {
    const raw = readFileSync(resolve(appDir, "..", "install.json"), "utf8").replace(/^\uFEFF/, "");
    return String(JSON.parse(raw).port ?? "");
  } catch {
    return "";
  }
}
const port = [setting("PORT"), installedPort()].find((p) => /^\d+$/.test(p)) ?? "8080";
// HTTPS when it has a certificate, which may have been uploaded in Settings
// rather than named in .env, so both are tried.
let scheme = setting("TLS_CERT_FILE") ? "https" : "http";
let url = `${scheme}://localhost:${port}`;

/** Whether this product answers on this machine, and on which scheme. */
function answersOn(tryScheme) {
  return new Promise((resolveAnswer) => {
    const get = tryScheme === "https" ? httpsGet : httpGet;
    // A local health check only: the certificate is often self-signed and
    // issued to the server's real name, not 127.0.0.1.
    const req = get(`${tryScheme}://127.0.0.1:${port}/api/v1/health`,
      { timeout: 2000, rejectUnauthorized: false },
      (res) => { res.resume(); resolveAnswer(res.statusCode === 200); });
    req.on("error", () => resolveAnswer(false));
    req.on("timeout", () => { req.destroy(); resolveAnswer(false); });
  });
}

async function answering() {
  for (const tryScheme of [scheme, scheme === "https" ? "http" : "https"]) {
    if (await answersOn(tryScheme)) {
      scheme = tryScheme;
      url = `${scheme}://localhost:${port}`;
      return true;
    }
  }
  return false;
}

function openBrowser() {
  // Through the shell, so Windows opens whatever the person's default
  // browser is rather than one we picked for them.
  // windowsHide for the same reason as everywhere else here: this process has
  // no console, so without it the command prompt that runs "start" is drawn
  // on screen for as long as it takes to hand the address to the browser.
  spawn("cmd", ["/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

function startIt() {
  const child = spawn(process.execPath, [join(appDir, "start.js")], {
    cwd: resolve(appDir, ".."),
    detached: true,
    // No console of its own. Without this the application lives inside a
    // window somebody is entitled to close, and closing it kills the product.
    // That reads as a crash and is not one.
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, OFFSET_DATA_DIR: root },
  });
  child.unref();
}

/** PowerShell quotes a string by doubling the quote inside it. */
function quoted(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}

/**
 * Says something when there is no console to say it in.
 *
 * All of this runs hidden now, which is the point. But a failure nobody can
 * see is worse than an ugly window, so a failure gets a dialog.
 */
function say(message, title) {
  spawn("powershell", [
    "-NoProfile", "-WindowStyle", "Hidden", "-Command",
    "Add-Type -AssemblyName PresentationFramework; " +
      `[System.Windows.MessageBox]::Show(${quoted(message)}, ${quoted(title)}, 0, 48) | Out-Null`,
  ], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

/** The launcher's own explanation of why it gave up, if it left one. */
function lastLauncherLines() {
  try {
    const text = readFileSync(join(root, "logs", "launcher.log"), "utf8");
    return text.trim().split(/\r?\n/).slice(-6).join("\n");
  } catch {
    return "";
  }
}

const display = productDisplay() || "Offset Security";

if (await answering()) {
  openBrowser();
  process.exit(0);
}

console.log("");
console.log(`  Starting ${display}...`);
console.log("");

startIt();

// Cold start is a database migration and two processes, so this waits rather
// than declaring failure after a second and a half.
for (let waited = 0; waited < 60; waited++) {
  await new Promise((r) => setTimeout(r, 1000));
  if (await answering()) {
    openBrowser();
    process.exit(0);
  }
}

const tail = lastLauncherLines();
say(
  `${display} did not start within a minute.\n\n` +
    (tail ? `Its log ends with:\n\n${tail}\n\n` : "") +
    `The full log is in:\n${join(root, "logs")}`,
  display,
);
process.exit(1);
