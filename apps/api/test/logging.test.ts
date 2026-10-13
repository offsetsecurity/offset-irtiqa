import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileSink, REDACT } from "../src/lib/logging.js";

/**
 * Log rotation.
 *
 * The interesting behaviour is not that lines get written — it is that the
 * file stops growing, that old generations are dropped rather than kept for
 * ever, and that a log that cannot be written never takes the product down
 * with it. A disk filled by our own log file would be a poor way to lose a
 * customer's compliance tool.
 */
const dirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "offset-log-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe("log files", () => {
  it("writes each line to the named file", () => {
    const dir = scratch();
    const sink = fileSink("app", { dir });

    sink.write("first");
    sink.write("second\n"); // already terminated: must not gain a blank line

    const body = readFileSync(join(dir, "app.log"), "utf8");
    expect(body).toBe("first\nsecond\n");
  });

  it("rotates once the file passes the limit", () => {
    const dir = scratch();
    const sink = fileSink("app", { dir, maxBytes: 100, keep: 3 });

    // 11 bytes a line, so the eleventh line crosses 100.
    for (let i = 0; i < 20; i++) sink.write("0123456789");

    expect(existsSync(join(dir, "app.log"))).toBe(true);
    expect(existsSync(join(dir, "app.log.1"))).toBe(true);

    // The live file is always under the limit; that is the whole point.
    const live = readFileSync(join(dir, "app.log"), "utf8");
    expect(live.length).toBeLessThanOrEqual(100);
  });

  it("keeps only the configured number of generations", () => {
    const dir = scratch();
    const sink = fileSink("app", { dir, maxBytes: 50, keep: 2 });

    for (let i = 0; i < 200; i++) sink.write(`line ${i} ${"x".repeat(20)}`);

    const files = readdirSync(dir).sort();
    expect(files).toEqual(["app.log", "app.log.1", "app.log.2"]);
  });

  it("keeps the newest rotated generation as .1", () => {
    const dir = scratch();
    const sink = fileSink("app", { dir, maxBytes: 40, keep: 2 });

    sink.write("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    sink.write("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
    sink.write("CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC");

    // Newest rotated content is .1, older is .2 — the order a person reading
    // them expects, and the order the pruning depends on.
    expect(readFileSync(join(dir, "app.log.1"), "utf8")).toContain("B");
    expect(readFileSync(join(dir, "app.log.2"), "utf8")).toContain("A");
  });

  it("counts an existing file rather than starting from zero", () => {
    const dir = scratch();
    writeFileSync(join(dir, "app.log"), "x".repeat(95), "utf8");

    const sink = fileSink("app", { dir, maxBytes: 100, keep: 2 });
    sink.write("this pushes it over");

    // A restart must not let the file grow past the limit unnoticed.
    expect(existsSync(join(dir, "app.log.1"))).toBe(true);
  });

  it("does not throw when the log cannot be written", () => {
    const dir = scratch();
    // A path where the parent is a file, so every write fails.
    const blocked = join(dir, "not-a-directory");
    writeFileSync(blocked, "", "utf8");

    const sink = fileSink("app", { dir: blocked });
    expect(() => sink.write("this cannot land anywhere")).not.toThrow();
  });
});

describe("redaction", () => {
  it("covers the fields that would make a log unsafe to email", () => {
    // A log is the one artefact a customer is asked to send to a stranger.
    for (const path of [
      "req.headers.cookie",
      "req.headers.authorization",
      "body.password",
      "*.password_hash",
      "*.SESSION_SECRET",
      "*.FIELD_ENC_KEY",
    ]) {
      expect(REDACT).toContain(path);
    }
  });
});
