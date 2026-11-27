import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net, { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { noIdleTimeout } from "../src/lib/long-request.js";

/**
 * G1 of the go-live gate for 0.3.0 (27 Nov 2026): a client that sent half a
 * request and stopped was held open for ever, on plain HTTP and on HTTPS, and
 * one that trickled a body a byte at a time was never cut off. The same fix
 * and tests as Offset Assure's (S1, and note 1 of its go-live review).
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;
const work = mkdtempSync(join(tmpdir(), "offset-stalled-"));

/** Says how long the server took to close a connection that went quiet, or -1 if it never did. */
function stall(socket: net.Socket | tls.TLSSocket, ms = 12_000): Promise<number> {
  const started = Date.now();
  return new Promise((resolve) => {
    socket.on("close", () => resolve(Date.now() - started));
    socket.on("error", () => {});
    setTimeout(() => resolve(-1), ms);
  });
}
const HALF = "POST /api/v1/auth/login HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{";

/** Sends a raw request and waits for the connection to close, keeping the status seen on the way. */
const untilClosed = (port: number, send: (sock: net.Socket) => void, waitMs: number) =>
  new Promise<{ status: number; closedAfter: number }>((resolve) => {
    const started = Date.now();
    let got = "";
    let settled = false;
    const sock = net.connect({ host: "127.0.0.1", port }, () => send(sock));
    const done = () => {
      if (settled) return;
      settled = true;
      const m = /^HTTP\/1\.1 (\d{3})/.exec(got);
      resolve({ status: m ? Number(m[1]) : 0, closedAfter: Date.now() - started });
      sock.destroy();
    };
    sock.on("data", (d: Buffer) => { got += d.toString("latin1"); });
    sock.on("error", () => { /* read in done() */ });
    sock.on("close", done);
    setTimeout(done, waitMs);
  });

maybe("stalled and slow requests are closed", () => {
  let app: FastifyInstance;

  const certificate = (name: string): { key: Buffer; cert: Buffer } => {
    const key = join(work, `${name}.key`);
    const cert = join(work, `${name}.crt`);
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-keyout", key, "-out", cert, "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
    return { key: readFileSync(key), cert: readFileSync(cert) };
  };

  beforeAll(async () => {
    await migrate();
    app = await buildApp();
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
    rmSync(work, { recursive: true, force: true });
  });

  it("G1: a plain connection that sends half a request and stops is closed by the server", async () => {
    const quick = await buildApp({ socketIdleTimeoutMs: 1500 });
    await quick.listen({ port: 0, host: "127.0.0.1" });
    const port = (quick.server.address() as AddressInfo).port;
    try {
      const socket = net.connect(port, "127.0.0.1");
      const closed = stall(socket);
      socket.write(HALF);
      const after = await closed;
      expect(after, "the server never closed the stalled connection").toBeGreaterThan(0);
      expect(after).toBeLessThan(10_000);
      socket.destroy();
      expect((await fetch(`http://127.0.0.1:${port}/api/v1/health`)).status).toBe(200);
    } finally {
      await quick.close();
    }
  }, 30_000);

  it("G1: the same over HTTPS", async () => {
    const secure = await buildApp({ https: certificate("g1"), socketIdleTimeoutMs: 1500 });
    await secure.listen({ port: 0, host: "127.0.0.1" });
    const port = (secure.server.address() as AddressInfo).port;
    try {
      const socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        // Trusts only the throwaway certificate made for this test.
        const s = tls.connect({ port, host: "127.0.0.1", ca: readFileSync(join(work, "g1.crt")), servername: "localhost" }, () => resolve(s));
        s.on("error", reject);
      });
      const closed = stall(socket);
      socket.write(HALF);
      const after = await closed;
      expect(after, "the HTTPS server never closed the stalled connection").toBeGreaterThan(0);
      expect(after).toBeLessThan(10_000);
    } finally {
      await secure.close();
    }
  }, 30_000);

  it("G1: the default settings are five minutes of silence and an hour for one whole request, on both servers", async () => {
    expect(app.server.timeout).toBe(300_000);
    expect(app.server.requestTimeout).toBe(3_600_000);
    const secure = await buildApp({ https: certificate("g1d") });
    try {
      expect(secure.server.timeout).toBe(300_000);
      expect(secure.server.requestTimeout).toBe(3_600_000);
    } finally {
      await secure.close();
    }
  });

  it("G1: making, uploading or putting back a backup, which can be silent for a long time, is exempt", () => {
    const calls: number[] = [];
    noIdleTimeout({ raw: { socket: { setTimeout: (ms: number) => calls.push(ms) } } } as never);
    expect(calls).toEqual([0]);
    expect(() => noIdleTimeout({ raw: {} } as never)).not.toThrow();
    expect(() => noIdleTimeout({ raw: { socket: {} } } as never)).not.toThrow();
  });

  it("G1: a body that trickles in is cut off at the body limit, not after an hour", async () => {
    const live = await buildApp({ bodyTimeoutMs: 1500 });
    await live.listen({ port: 0, host: "127.0.0.1" });
    const port = (live.server.address() as AddressInfo).port;
    try {
      const slow = await untilClosed(port, (sock) => {
        sock.write("POST /api/v1/auth/login HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{");
        const drip = setInterval(() => { if (!sock.destroyed) sock.write(" "); }, 300);
        sock.on("close", () => clearInterval(drip));
      }, 10_000);
      expect(slow.closedAfter, "the connection should be closed soon after 1.5 s").toBeLessThan(5000);
      expect(slow.closedAfter).toBeGreaterThanOrEqual(1400);
      // A normal request on the same server is not affected.
      const body = JSON.stringify({ username: "nobody", password: "wrong-password-here" });
      const ok = await untilClosed(port, (sock) => {
        sock.write(`POST /api/v1/auth/login HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
      }, 5000);
      expect(ok.status).toBe(401);
    } finally {
      await live.close();
    }
  }, 30_000);

  it("G1: a body still trickling after an early refusal is cut off at the body limit too", async () => {
    const live = await buildApp({ bodyTimeoutMs: 1500 });
    await live.listen({ port: 0, host: "127.0.0.1" });
    const port = (live.server.address() as AddressInfo).port;
    try {
      // Refused before the body is read (nobody signed in), then the body keeps coming.
      const refused = await untilClosed(port, (sock) => {
        sock.write("POST /api/v1/backups/upload HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: multipart/form-data; boundary=x\r\nTransfer-Encoding: chunked\r\n\r\n");
        const drip = setInterval(() => { if (!sock.destroyed) sock.write("1\r\n \r\n"); }, 200);
        sock.on("close", () => clearInterval(drip));
      }, 10_000);
      expect(refused.status).toBe(401);
      expect(refused.closedAfter, "closed at the body limit, not held").toBeLessThan(5000);
    } finally {
      await live.close();
    }
  }, 30_000);
});
