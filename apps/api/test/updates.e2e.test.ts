import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { makeKeys, startChannel, type Channel } from "./support/release-fixture.js";

/** Straight from the environment: importing config would parse it too early. */
const PRODUCT = process.env["PRODUCT"] ?? "align";

/**
 * Settings → Updates, through the API.
 *
 * The application's part is small and has to be exactly right: only an
 * administrator may ask, only for the signed latest release, only forward,
 * only when an updater exists to act on it, and always with a backup taken
 * first. It installs nothing itself.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

const DOCKER = {
  image: `ghcr.io/offsetsecurity/offset-${PRODUCT}`,
  digest: `sha256:${"a".repeat(64)}`,
  updaterImage: `ghcr.io/offsetsecurity/offset-${PRODUCT}-updater`,
  updaterDigest: `sha256:${"b".repeat(64)}`,
};

const release = (version: string, products: Record<string, unknown> = { [PRODUCT]: { docker: DOCKER } }) => ({
  schema: 1, version, published: "2026-09-17T10:00:00Z", notes: `Notes for ${version}.`, products,
});

maybe("updates", () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  let pool: { end: () => Promise<void> } | undefined;
  let channel: Channel;
  const keys = makeKeys();
  const root = mkdtempSync(join(tmpdir(), "offset-updates-"));
  const requestDir = join(root, "request");
  const statusDir = join(root, "status");
  const backupDir = join(root, "backups");

  let sid = "";
  let csrf = "";
  const admin = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });
  const cookies = (res: LightMyRequestResponse): [string, string] => {
    let s = "";
    let c = "";
    for (const line of res.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(line);
      if (m?.[1] === "offset_sid") s = m[2]!;
      if (m?.[1] === "offset_csrf") c = m[2]!;
    }
    return [s, c];
  };

  const presence = (seenAt = new Date().toISOString()) =>
    writeFileSync(join(statusDir, "updater.json"), JSON.stringify({ kind: "docker", seenAt }));

  beforeAll(async () => {
    channel = await startChannel();
    mkdirSync(statusDir, { recursive: true });

    // Read once, at import, so all of it has to be in place first.
    Object.assign(process.env, {
      OFFSET_VERSION: "0.1.0",
      INSTALL_KIND: "docker",
      UPDATE_URL: channel.url("/release.json"),
      UPDATE_TRUSTED_KEYS: keys.publicRaw,
      UPDATE_ALLOW_HTTP: "true",
      UPDATE_REQUEST_DIR: requestDir,
      UPDATE_STATUS_DIR: statusDir,
      BACKUP_DIR: backupDir,
    });

    const { migrate } = await import("../src/db/migrate.js");
    const db = await import("../src/db/pool.js");
    pool = db.pool;
    query = db.query as typeof query;
    await migrate();
    for (const t of ["audit_log", "sessions", "users", "settings"]) await query(`delete from ${t}`);

    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();

    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "admin", name: "Admin", email: "admin@example.test", password: "correct-horse-battery-staple" },
    });
    [sid, csrf] = cookies(boot);
  }, 60_000);

  afterAll(async () => {
    for (const k of ["OFFSET_VERSION", "INSTALL_KIND", "UPDATE_URL", "UPDATE_TRUSTED_KEYS", "UPDATE_ALLOW_HTTP",
      "UPDATE_REQUEST_DIR", "UPDATE_STATUS_DIR", "BACKUP_DIR"]) delete process.env[k];
    await app?.close();
    await pool?.end();
    await channel?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("is for administrators only, even to look at", async () => {
    expect((await app.inject({ url: "/api/v1/updates" })).statusCode).toBe(401);

    await app.inject({
      method: "POST", url: "/api/v1/users", headers: admin(),
      payload: { username: "viewer", name: "Viewer", email: "v@example.test", role: "readonly", password: "another-long-password-here" },
    });
    const login = await app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { username: "viewer", password: "another-long-password-here" },
    });
    const [vs, vc] = cookies(login);
    const viewer = { cookie: `offset_sid=${vs}; offset_csrf=${vc}`, "x-csrf-token": vc };

    expect((await app.inject({ url: "/api/v1/updates", headers: viewer })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/v1/updates/check", headers: viewer })).statusCode).toBe(403);
    expect((await app.inject({
      method: "POST", url: "/api/v1/updates/apply", headers: viewer, payload: { version: "0.2.0" },
    })).statusCode).toBe(403);
  });

  it("reports what this copy is, and that nothing has been checked yet", async () => {
    const res = await app.inject({ url: "/api/v1/updates", headers: admin() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      current: "0.1.0", installKind: "docker", lastCheck: null, status: null, customKeys: true,
      updater: { present: false },
    });
  });

  it("finds a newer signed release and remembers the answer", async () => {
    channel.publish(release("0.2.0"), keys);
    const res = await app.inject({ method: "POST", url: "/api/v1/updates/check", headers: admin() });
    expect(res.json().lastCheck).toMatchObject({
      current: "0.1.0", latest: "0.2.0", newer: true, installable: true, error: null, notes: "Notes for 0.2.0.",
    });
    expect((await app.inject({ url: "/api/v1/updates", headers: admin() })).json().lastCheck.latest).toBe("0.2.0");
  });

  it("says so when the release is forged, and offers nothing", async () => {
    const forger = makeKeys();
    channel.publish(release("9.9.9"), forger);
    const res = await app.inject({ method: "POST", url: "/api/v1/updates/check", headers: admin() });
    expect(res.json().lastCheck).toMatchObject({ latest: null, newer: false, installable: false });
    expect(res.json().lastCheck.error).toMatch(/not signed by Offset Security/);
  });

  it("will not ask for an update when no updater is there to do it", async () => {
    channel.publish(release("0.2.0"), keys);
    const res = await app.inject({
      method: "POST", url: "/api/v1/updates/apply", headers: admin(), payload: { version: "0.2.0" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/updater container is not running/);

    // A Docker updater that stopped reporting counts as absent too.
    presence(new Date(Date.now() - 10 * 60_000).toISOString());
    const stale = await app.inject({
      method: "POST", url: "/api/v1/updates/apply", headers: admin(), payload: { version: "0.2.0" },
    });
    expect(stale.statusCode).toBe(400);
    expect(existsSync(join(requestDir, "request.json"))).toBe(false);
  });

  it("refuses anything but the signed latest, and never goes backwards", async () => {
    presence();
    const ask = (version: string) => app.inject({
      method: "POST", url: "/api/v1/updates/apply", headers: admin(), payload: { version },
    });

    channel.publish(release("0.2.0"), keys);
    const notLatest = await ask("0.3.0");
    expect(notLatest.statusCode).toBe(400);
    expect(notLatest.json().error).toMatch(/not the latest release/);

    channel.publish(release("0.1.0"), keys);
    expect((await ask("0.1.0")).json().error).toMatch(/already on 0.1.0/);

    channel.publish(release("0.0.9"), keys);
    expect((await ask("0.0.9")).statusCode).toBe(400);

    channel.publish(release("0.2.0", { [PRODUCT]: { linux: { url: "https://x.example/a.tgz", sha256: "c".repeat(64), size: 5 } } }), keys);
    expect((await ask("0.2.0")).json().error).toMatch(/no docker package/);

    expect(existsSync(join(requestDir, "request.json"))).toBe(false);
  });

  it("takes a backup, leaves a request, and records who asked", async () => {
    presence();
    channel.publish(release("0.2.0"), keys);
    const res = await app.inject({
      method: "POST", url: "/api/v1/updates/apply", headers: admin(), payload: { version: "0.2.0" },
    });
    expect(res.statusCode).toBe(202);

    const request = JSON.parse(readFileSync(join(requestDir, "request.json"), "utf8"));
    expect(request).toMatchObject({ version: "0.2.0", requestedBy: "admin" });
    // The backup exists before the updater could possibly have started.
    expect(existsSync(join(backupDir, request.backup))).toBe(true);

    const { rows } = await query("select action, after from audit_log where action = 'Update requested'");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!["after"] as string)).toMatchObject({ version: "0.2.0" });
  });

  it("will not start a second update while one is under way", async () => {
    presence();
    writeFileSync(join(statusDir, "status.json"), JSON.stringify({
      requestId: "x", version: "0.2.0", from: "0.1.0", state: "installing",
      message: "", updatedAt: new Date().toISOString(),
    }));
    const res = await app.inject({
      method: "POST", url: "/api/v1/updates/apply", headers: admin(), payload: { version: "0.2.0" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/already in progress/);
    expect((await app.inject({ url: "/api/v1/updates", headers: admin() })).json().status.state).toBe("installing");
  });

  it("only accepts a plain version in the request", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/updates/apply", headers: admin(), payload: { version: "0.2.0; reboot" },
    });
    expect(res.statusCode).toBe(400);
  });
});
