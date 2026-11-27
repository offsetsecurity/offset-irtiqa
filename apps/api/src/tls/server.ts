/**
 * The HTTPS server, built so that plain `http://` on the same port still
 * works: it answers with a redirect to `https://` instead of a connection
 * that drops with no explanation.
 *
 * That matters more than it sounds. The Start menu shortcut, the address the
 * installer printed, every bookmark made before HTTPS was turned on - all of
 * them say `http://`. Without this, turning HTTPS on breaks every one of them
 * with "This page isn't working", which is exactly when people decide the
 * certificate was a mistake.
 *
 * How: every TLS connection starts with a handshake record, whose first byte
 * is 0x16. An HTTP request starts with a letter. The first byte of each new
 * connection decides which server gets it. Nothing is consumed; the byte is
 * put back before either server reads.
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import type { Socket } from "node:net";
import type { TlsOptions } from "./certificate.js";

const TLS_HANDSHAKE = 0x16;

/**
 * The lowest TLS version the server accepts, set here rather than left to
 * Node.js. Its default is TLS 1.2 today, but `--tls-min-v1.0`, NODE_OPTIONS or
 * a future default would lower it for any server that does not say.
 */
export const MIN_TLS_VERSION = "TLSv1.2" as const;

/**
 * The ciphers the server accepts, also set here so `--tls-cipher-list` or a
 * lowered default cannot add weak ones. TLS 1.3: its three standard suites.
 * TLS 1.2: only key exchanges with forward secrecy (ECDHE) and authenticated
 * encryption (AES-GCM, ChaCha20-Poly1305), as in Mozilla's "intermediate"
 * profile without the slow DHE ones. Every browser of the last ten years
 * speaks these. As in that profile, the client chooses among them, so a phone
 * without AES hardware can pick ChaCha20; every choice on the list is strong.
 */
export const TLS_CIPHERS = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
].join(":");

/** What every secure context of this server is given. */
const TLS_RULES = { minVersion: MIN_TLS_VERSION, ciphers: TLS_CIPHERS } as const;

/** The server this process is serving HTTPS on, if it is. */
let live: HttpsServer | null = null;

export function servingHttps(): boolean {
  return live !== null;
}

/**
 * Puts a new certificate on the running server. New connections get it at
 * once; connections already open keep the old one until they close. Returns
 * false when this process is serving plain HTTP, where only a restart helps.
 */
export function applyLive(options: TlsOptions): boolean {
  if (!live) return false;
  live.setSecureContext({ ...options, ...TLS_RULES });
  return true;
}

function redirect(req: IncomingMessage, res: ServerResponse): void {
  const host = req.headers.host ?? "";
  // Only ever back to the address the browser itself asked for. Anything that
  // is not a plain host[:port] gets a refusal, not a redirect somewhere else.
  if (!/^[A-Za-z0-9.\-[\]:]{1,300}$/.test(host)) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("This address only answers over HTTPS.\n");
    return;
  }
  // 307, not 301 or 308. Temporary, so a browser does not remember it for
  // ever and refuse plain HTTP if HTTPS is ever turned off again; and unlike
  // 308, Windows PowerShell 5.1 follows it, which the installer relies on.
  res.writeHead(307, { location: `https://${host}${req.url ?? "/"}` });
  res.end();
}

/**
 * A Fastify `serverFactory` for HTTPS on a port that also turns `http://`
 * into a redirect.
 */
export function dualServerFactory(options: TlsOptions, limits: { idleMs: number; requestMs: number }) {
  return (handler: (req: IncomingMessage, res: ServerResponse) => void): HttpsServer => {
    const secure = createHttpsServer({ ...options, ...TLS_RULES }, handler);
    // Fastify sets these on a server it makes itself, and not on one a
    // serverFactory makes: so they are set here, or a server that answers
    // HTTPS would hold a half-sent request for ever.
    secure.setTimeout(limits.idleMs);
    secure.requestTimeout = limits.requestMs;
    const plain = createHttpServer(redirect);
    // The plain server only ever sends a redirect: it has no business holding
    // a connection open for long.
    plain.setTimeout(30_000);
    plain.requestTimeout = 30_000;

    // The TLS server's own listener turns a socket into a TLS connection.
    // Take it out, and hand it only the sockets that start with a handshake.
    const startTls = secure.listeners("connection") as ((s: Socket) => void)[];
    secure.removeAllListeners("connection");
    secure.on("connection", (socket: Socket) => {
      socket.once("readable", () => {
        socket.setTimeout(0);
        const first = socket.read(1) as Buffer | null;
        if (!first) {
          socket.destroy();
          return;
        }
        socket.unshift(first);
        if (first[0] === TLS_HANDSHAKE) for (const l of startTls) l.call(secure, socket);
        else plain.emit("connection", socket);
      });
      // A client that connects and says nothing must not hold the socket for
      // ever. Cleared above once it speaks; the servers' own timeouts take over.
      socket.setTimeout(30_000, () => socket.destroy());
    });

    live = secure;
    secure.on("close", () => {
      if (live === secure) live = null;
    });
    return secure;
  };
}
