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
  live.setSecureContext(options);
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
export function dualServerFactory(options: TlsOptions) {
  return (handler: (req: IncomingMessage, res: ServerResponse) => void): HttpsServer => {
    const secure = createHttpsServer(options, handler);
    const plain = createHttpServer(redirect);

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
