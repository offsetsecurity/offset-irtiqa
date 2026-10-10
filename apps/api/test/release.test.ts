import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  downloadVerified, fetchRelease, isNewer, parseVersion, ReleaseError, TRUSTED_KEYS,
  usableKeys, validateRelease, verifyRelease,
} from "../src/update/release.js";
import { parseRequest, readSmallJson, takeRequest, writeJsonAtomic } from "../src/update/files.js";
import { makeKeys, sha256, signBody, startChannel, type Channel } from "./support/release-fixture.js";

/**
 * Trusting a release.
 *
 * This is the code that stands between a customer's server and whatever
 * somebody manages to put at the update address. Every test here is a way an
 * update could be forged, replayed, swapped or smuggled, and each has to be
 * refused.
 */

const DOCKER = {
  image: "ghcr.io/offsetsecurity/offset-ascend",
  digest: `sha256:${"a".repeat(64)}`,
  updaterImage: "ghcr.io/offsetsecurity/offset-ascend-updater",
  updaterDigest: `sha256:${"b".repeat(64)}`,
};

const release = (over: Record<string, unknown> = {}) => ({
  schema: 1,
  version: "0.2.0",
  published: "2026-09-17T10:00:00Z",
  notes: "Better things.",
  products: { ascend: { docker: DOCKER } },
  ...over,
});

describe("versions", () => {
  it("reads only plain x.y.z", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    for (const bad of ["1.2", "v1.2.3", "1.2.3-beta", "01.2.3", "1.2.3.4", "../1.2.3", ""]) {
      expect(parseVersion(bad), bad).toBeNull();
    }
  });

  it("goes forward only", () => {
    expect(isNewer("0.2.0", "0.1.9")).toBe(true);
    expect(isNewer("0.10.0", "0.9.0")).toBe(true); // numbers, not text
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    // The same version, and anything older, is never "newer": a signed old
    // release is how a fixed flaw gets put back.
    expect(isNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isNewer("0.1.9", "0.2.0")).toBe(false);
    expect(isNewer("garbage", "0.1.0")).toBe(false);
  });
});

describe("signatures", () => {
  const keys = makeKeys();
  const body = Buffer.from(JSON.stringify(release()));

  it("accepts a release signed with a trusted key", () => {
    const r = verifyRelease(body, signBody(body, keys), [keys.publicRaw]);
    expect(r.version).toBe("0.2.0");
    expect(r.products["ascend"]?.docker?.digest).toBe(DOCKER.digest);
  });

  it("refuses a release changed by a single byte after signing", () => {
    const sig = signBody(body, keys);
    const tampered = Buffer.from(body.toString().replace("0.2.0", "0.2.1"));
    expect(() => verifyRelease(tampered, sig, [keys.publicRaw])).toThrow(/not signed by Offset Security/);
  });

  it("refuses a release signed by anybody else", () => {
    const stranger = makeKeys();
    expect(() => verifyRelease(body, signBody(body, stranger), [keys.publicRaw])).toThrow(ReleaseError);
  });

  it("refuses everything when no real key is configured", () => {
    expect(() => verifyRelease(body, signBody(body, keys), ["__RELEASE_PUBLIC_KEY__", ""]))
      .toThrow(/No release signing key/);
  });

  it("refuses a signature of the wrong shape", () => {
    expect(() => verifyRelease(body, "not a signature", [keys.publicRaw])).toThrow(ReleaseError);
  });

  it("ships with exactly the real signing key and no placeholder", () => {
    // If this fails, every install built from this commit would refuse every
    // update, or worse, trust a key nobody holds.
    expect(usableKeys(TRUSTED_KEYS)).toHaveLength(TRUSTED_KEYS.length);
    expect(TRUSTED_KEYS.length).toBeGreaterThanOrEqual(1);
  });
});

describe("manifest shape", () => {
  it("refuses downloads that are not HTTPS, unless told this is a test", () => {
    const r = release({
      products: { ascend: { linux: { url: "http://evil.example/x.tgz", sha256: "c".repeat(64), size: 10 } } },
    });
    expect(() => validateRelease(r)).toThrow(/not served over HTTPS/);
    expect(validateRelease(r, { allowHttp: true }).products["ascend"]?.linux?.size).toBe(10);
  });

  it("refuses anything an updater would act on that is malformed", () => {
    const bad = [
      release({ schema: 2 }),
      release({ version: "0.2.0; rm -rf /" }),
      release({ products: { "../ascend": { docker: DOCKER } } }),
      release({ products: { ascend: { docker: { ...DOCKER, digest: "latest" } } } }),
      release({ products: { ascend: { docker: { ...DOCKER, image: "evil.example/x --privileged" } } } }),
      release({ products: { ascend: { linux: { url: "https://x.example/a", sha256: "short", size: 1 } } } }),
      release({ products: { ascend: { windows: { url: "https://x.example/a", sha256: "c".repeat(64), size: -1 } } } }),
    ];
    for (const r of bad) expect(() => validateRelease(r)).toThrow(ReleaseError);
  });
});

describe("over the network", () => {
  let channel: Channel;
  const keys = makeKeys();
  const dir = mkdtempSync(join(tmpdir(), "offset-release-"));

  beforeAll(async () => {
    channel = await startChannel();
  });
  afterAll(async () => {
    await channel.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("fetches and verifies the manifest and its signature", async () => {
    channel.publish(release(), keys);
    const r = await fetchRelease(channel.url("/release.json"), { keys: [keys.publicRaw], allowHttp: true });
    expect(r.version).toBe("0.2.0");
  });

  it("says plainly when there is no signature to check", async () => {
    channel.publish(release(), keys);
    channel.set("/release.json.sig", null);
    await expect(
      fetchRelease(channel.url("/release.json"), { keys: [keys.publicRaw], allowHttp: true }),
    ).rejects.toThrow(/answered 404/);
  });

  it("says plainly when the server cannot be reached", async () => {
    await expect(
      fetchRelease("http://127.0.0.1:1/release.json", { keys: [keys.publicRaw], allowHttp: true, timeoutMs: 2000 }),
    ).rejects.toThrow(/offline installer/);
  });

  it("keeps a download only when it matches the signed hash", async () => {
    const payload = Buffer.from("the real installer");
    channel.set("/good.tgz", payload);
    const good = join(dir, "good.tgz");
    await downloadVerified(
      { url: channel.url("/good.tgz"), sha256: sha256(payload), size: payload.length },
      good, { allowHttp: true },
    );
    expect(readFileSync(good, "utf8")).toBe("the real installer");

    // Swapped on the server after the release was signed.
    channel.set("/swapped.tgz", Buffer.from("the evil installer"));
    const swapped = join(dir, "swapped.tgz");
    await expect(downloadVerified(
      { url: channel.url("/swapped.tgz"), sha256: sha256(payload), size: payload.length },
      swapped, { allowHttp: true },
    )).rejects.toThrow(/does not match the signed release/);
    expect(existsSync(swapped)).toBe(false);

    // Padded, which is also how a slow disk-filling attack starts.
    channel.set("/big.tgz", Buffer.alloc(payload.length + 1000, 1));
    const big = join(dir, "big.tgz");
    await expect(downloadVerified(
      { url: channel.url("/big.tgz"), sha256: sha256(payload), size: payload.length },
      big, { allowHttp: true },
    )).rejects.toThrow(/larger than the release says/);
    expect(existsSync(big)).toBe(false);
  });
});

describe("the request handoff", () => {
  const dir = mkdtempSync(join(tmpdir(), "offset-handoff-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const valid = {
    id: "0b0f4a5e-6f47-4d8e-9c1a-3a6f2f0d9b11",
    version: "0.2.0",
    backup: "pre-update-0.2.0-2026-09-17T10-00-00-000Z.db",
    requestedBy: "admin",
    requestedAt: "2026-09-17T10:00:00.000Z",
  };

  it("accepts only a request with nothing smuggled in it", () => {
    expect(parseRequest(valid)?.version).toBe("0.2.0");
    for (const over of [
      { version: "0.2.0 && reboot" },
      { backup: "../../etc/shadow" },
      { backup: "pre-update-x/../../y.db" },
      { id: "not-a-uuid" },
    ]) {
      expect(parseRequest({ ...valid, ...over }), JSON.stringify(over)).toBeNull();
    }
  });

  it("reads a request once, then it is gone", async () => {
    await writeJsonAtomic(join(dir, "request.json"), valid);
    expect((await takeRequest(dir))?.id).toBe(valid.id);
    expect(await takeRequest(dir)).toBeNull();
  });

  it("will not follow a link planted where a request should be", async (ctx) => {
    const target = join(dir, "secret.json");
    writeFileSync(target, JSON.stringify(valid));
    try {
      symlinkSync(target, join(dir, "request.json"));
    } catch {
      ctx.skip(); // creating links needs a privilege Windows does not give by default
    }
    expect(await readSmallJson(join(dir, "request.json"))).toBeNull();
  });
});
