import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net, { type AddressInfo } from "node:net";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";

/**
 * G9 of the go-live gate for 0.3.0 (27 Nov 2026; N1 and note 4 in Offset
 * Assure): a JSON body over the limit, sent to sign-in, sign-out or anywhere
 * else, was never answered: the connection was cut and the client saw
 * nothing. It must be told 413, whether the length was declared or not.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

/** Sends a raw request and resolves with the status the server answered (0: none). */
const rawStatus = (port: number, send: (sock: net.Socket) => void, waitMs: number) =>
  new Promise<number>((resolve) => {
    let got = "";
    let settled = false;
    const sock = net.connect({ host: "127.0.0.1", port }, () => send(sock));
    const done = () => {
      if (settled) return;
      settled = true;
      const m = /^HTTP\/1\.1 (\d{3})/.exec(got);
      resolve(m ? Number(m[1]) : 0);
      sock.destroy();
    };
    sock.on("data", (d: Buffer) => { got += d.toString("latin1"); if (got.includes("\r\n\r\n")) done(); });
    sock.on("error", () => { /* what arrived before is read in done() */ });
    sock.on("close", done);
    setTimeout(done, waitMs);
  });

maybe("a body over the limit is answered", () => {
  beforeAll(async () => { await migrate(); }, 60_000);
  afterAll(async () => { await pool.end(); });

  it("G9: a JSON body over the limit is answered with 413 at once, on sign-in, sign-out and an unknown address", async () => {
    const live = await buildApp();
    await live.listen({ port: 0, host: "127.0.0.1" });
    const port = (live.server.address() as AddressInfo).port;
    const body = Buffer.from(`{"title":"${"a".repeat(6_000_000)}"}`);
    try {
      for (const path of ["/api/v1/auth/login", "/api/v1/auth/logout", "/api/v1/nothing-here"]) {
        const started = Date.now();
        const status = await rawStatus(port, (sock) => {
          sock.write(`POST ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n`);
          sock.write(body);
        }, 8000);
        expect(status, `${path} answered ${status} (0: the connection was cut with no answer)`).toBe(413);
        expect(Date.now() - started, `${path} took too long`).toBeLessThan(6000);
      }
    } finally {
      await live.close();
    }
  }, 40_000);

  it("G9: an oversized body sent without saying its length first is answered with 413", async () => {
    const live = await buildApp();
    await live.listen({ port: 0, host: "127.0.0.1" });
    const port = (live.server.address() as AddressInfo).port;
    try {
      const big = Buffer.from(`{"title":"${"a".repeat(3_000_000)}"}`);
      const status = await rawStatus(port, (sock) => {
        sock.write("POST /api/v1/auth/login HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n");
        for (let i = 0; i < big.length; i += 65_536) {
          const part = big.subarray(i, i + 65_536);
          sock.write(`${part.length.toString(16)}\r\n`);
          sock.write(part);
          sock.write("\r\n");
        }
        sock.write("0\r\n\r\n");
      }, 10_000);
      expect(status, "0: the connection was cut with no answer").toBe(413);
    } finally {
      await live.close();
    }
  }, 30_000);
});
