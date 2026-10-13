import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A throwaway release channel: a signing key and a tiny HTTP server.
 *
 * Tests sign with their own key, never the real one, and serve over plain HTTP
 * on 127.0.0.1, which the code under test only accepts when told it is a test.
 */

export interface TestKeys {
  privateKey: KeyObject;
  /** base64url raw public key, the form TRUSTED_KEYS uses. */
  publicRaw: string;
}

export function makeKeys(): TestKeys {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicRaw: publicKey.export({ format: "jwk" }).x as string };
}

export function signBody(body: Buffer, keys: TestKeys): string {
  return sign(null, body, keys.privateKey).toString("base64");
}

export const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

export interface Channel {
  url: (path: string) => string;
  /** Replace what a path serves. A Buffer is served as-is; null makes it a 404. */
  set: (path: string, body: Buffer | string | null) => void;
  /** Sign and publish a manifest at /release.json and /release.json.sig. */
  publish: (release: unknown, keys: TestKeys) => Buffer;
  close: () => Promise<void>;
}

export async function startChannel(): Promise<Channel> {
  const files = new Map<string, Buffer>();
  const server: Server = createServer((req, res) => {
    const body = files.get((req.url ?? "").split("?")[0] ?? "");
    if (!body) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-length": body.length }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;

  const set = (path: string, body: Buffer | string | null): void => {
    if (body === null) files.delete(path);
    else files.set(path, Buffer.isBuffer(body) ? body : Buffer.from(body));
  };

  return {
    url: (path) => `http://127.0.0.1:${port}${path}`,
    set,
    publish: (release, keys) => {
      const body = Buffer.from(JSON.stringify(release, null, 2));
      set("/release.json", body);
      set("/release.json.sig", signBody(body, keys));
      return body;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** A well-formed release for `products`, with every file pointing at the channel. */
export function releaseFor(
  version: string,
  channel: Channel,
  artifacts: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  return {
    schema: 1,
    version,
    published: "2026-09-17T10:00:00Z",
    notes: `What changed in ${version}.`,
    products: artifacts,
  };
}
