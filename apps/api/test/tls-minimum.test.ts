import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpsServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { applyLive, dualServerFactory, MIN_TLS_VERSION } from "../src/tls/server.js";

/**
 * The lowest TLS version is the product's own decision, not Node.js's.
 *
 * Node.js refuses TLS 1.0 and 1.1 by default today, but a `--tls-min-v1.0`
 * flag, NODE_OPTIONS, or a future default would lower it for every server that
 * does not say. The test lowers Node's defaults the way such a flag does, then
 * offers TLS 1.1: the product's server must still refuse it, both as started
 * and after a certificate is put on the running server.
 *
 * A plain server with no minimum of its own is the control: it must accept
 * TLS 1.1 under the same lowered defaults, or this machine cannot speak TLS 1.1
 * at all and a "refused" would prove nothing. The certificate is made with
 * openssl, so the file is skipped where openssl is not installed.
 */
const hasOpenssl = (() => {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const saved = { min: tls.DEFAULT_MIN_VERSION, ciphers: tls.DEFAULT_CIPHERS };
let dir: string;
let key: Buffer;
let cert: Buffer;
let server: Server;
let control: Server;
let port: number;
let controlPort: number;

function handshake(version: tls.SecureVersion, to = port): Promise<string> {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: "127.0.0.1",
      port: to,
      rejectUnauthorized: false,
      minVersion: version,
      maxVersion: version,
      // Old versions need old signatures, which OpenSSL's default level refuses
      // on both sides. Allowed here so only the version setting can say no.
      ciphers: "DEFAULT@SECLEVEL=0",
    });
    socket.once("secureConnect", () => {
      const got = socket.getProtocol() ?? "unknown";
      socket.destroy();
      resolve(got);
    });
    socket.once("error", () => resolve("refused"));
  });
}

describe.skipIf(!hasOpenssl)("HTTPS minimum version", () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "offset-tls-min-"));
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
      "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-subj", "/CN=localhost",
    ], { stdio: "ignore" });
    key = readFileSync(join(dir, "key.pem"));
    cert = readFileSync(join(dir, "cert.pem"));

    // What `node --tls-min-v1.0` does, plus the old ciphers TLS 1.1 needs.
    tls.DEFAULT_MIN_VERSION = "TLSv1";
    tls.DEFAULT_CIPHERS = "DEFAULT@SECLEVEL=0";

    server = dualServerFactory({ key, cert })((_req, res) => res.end("ok"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;

    control = createHttpsServer({ key, cert }, (_req, res) => res.end("ok"));
    await new Promise<void>((r) => control.listen(0, "127.0.0.1", r));
    controlPort = (control.address() as AddressInfo).port;
  });

  afterAll(async () => {
    tls.DEFAULT_MIN_VERSION = saved.min;
    tls.DEFAULT_CIPHERS = saved.ciphers;
    await new Promise((r) => server?.close(r));
    await new Promise((r) => control?.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  it("is TLS 1.2", () => {
    expect(MIN_TLS_VERSION).toBe("TLSv1.2");
  });

  it("refuses TLS 1.1 even when Node.js's own minimum is lowered", async (ctx) => {
    if ((await handshake("TLSv1.1", controlPort)) !== "TLSv1.1") ctx.skip("this machine cannot speak TLS 1.1 at all");
    expect(await handshake("TLSv1.1")).toBe("refused");
    expect(await handshake("TLSv1.2")).toBe("TLSv1.2");
    expect(await handshake("TLSv1.3")).toBe("TLSv1.3");
  });

  it("still refuses TLS 1.1 after a new certificate is put on the running server", async (ctx) => {
    if ((await handshake("TLSv1.1", controlPort)) !== "TLSv1.1") ctx.skip("this machine cannot speak TLS 1.1 at all");
    expect(applyLive({ key, cert })).toBe(true);
    expect(await handshake("TLSv1.1")).toBe("refused");
    expect(await handshake("TLSv1.2")).toBe("TLSv1.2");
  });
});
