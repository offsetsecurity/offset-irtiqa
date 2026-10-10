import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { prepareUpload, removeUpload, tlsDir, type TlsOptions } from "../src/tls/certificate.js";

/**
 * Settings → HTTPS certificate.
 *
 * Real certificates, made with openssl for each run, because the parts worth
 * testing are the ones a mock would agree with: whether a key really belongs
 * to a certificate, whether a .pfx password opens it, and whether a running
 * HTTPS server really hands out the new certificate after an upload.
 *
 * None are committed. Private keys in a repository trip every secret scanner,
 * and rightly.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

const work = mkdtempSync(join(tmpdir(), "offset-cert-"));

/** A certificate and key for `name`, signed by itself or by `ca`. */
function issue(file: string, name: string, ca?: string): void {
  const key = join(work, `${file}.key`);
  const cert = join(work, `${file}.crt`);
  const san = `subjectAltName=DNS:${name},DNS:localhost,IP:127.0.0.1`;
  if (!ca) {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "90",
      "-keyout", key, "-out", cert, "-subj", `/CN=${name}`, "-addext", san,
    ], { stdio: "ignore" });
    return;
  }
  const csr = join(work, `${file}.csr`);
  const ext = join(work, `${file}.ext`);
  execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", csr, "-subj", `/CN=${name}`], { stdio: "ignore" });
  writeFileSync(ext, `${san}\n`);
  execFileSync("openssl", [
    "x509", "-req", "-in", csr, "-CA", join(work, `${ca}.crt`), "-CAkey", join(work, `${ca}.key`),
    "-CAcreateserial", "-days", "90", "-out", cert, "-extfile", ext,
  ], { stdio: "ignore" });
}

const b64 = (file: string) => readFileSync(join(work, file)).toString("base64");
const upload = (name: string) => ({ name, data: b64(name) });

maybe("HTTPS certificate", () => {
  let app: FastifyInstance;
  let sid = "";
  let csrf = "";
  const auth = () => ({ cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf });

  beforeAll(async () => {
    issue("ca", "Example Company CA");
    issue("grc", "grc.example.test", "ca");
    issue("other", "other.example.test");
    execFileSync("openssl", [
      "pkcs12", "-export", "-in", join(work, "grc.crt"), "-inkey", join(work, "grc.key"),
      "-certfile", join(work, "ca.crt"), "-out", join(work, "grc.pfx"), "-passout", "pass:open sesame",
    ], { stdio: "ignore" });
    execFileSync("openssl", [
      "pkcs8", "-topk8", "-in", join(work, "grc.key"), "-out", join(work, "grc-locked.key"), "-passout", "pass:hunter22",
    ], { stdio: "ignore" });

    removeUpload();
    await migrate();
    for (const t of ["audit_log", "sessions", "users"]) await query(`delete from ${t}`);
    app = await buildApp();
    await app.ready();
    const boot = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { username: "certadmin", name: "Cert Admin", email: "cert@example.test", password: "correct-horse-battery-staple" },
    });
    for (const c of boot.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(c);
      if (m?.[1] === "offset_sid") sid = m[2]!;
      if (m?.[1] === "offset_csrf") csrf = m[2]!;
    }
  }, 60_000);

  afterAll(async () => {
    removeUpload();
    rmSync(tlsDir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
    await app?.close();
    await pool.end();
  });

  describe("checking what was chosen", () => {
    it("accepts a certificate and its key, in either order, and puts the right certificate first", () => {
      const { options, info } = prepareUpload([upload("ca.crt"), upload("grc.key"), upload("grc.crt")], "");
      expect(info.subject).toBe("grc.example.test");
      expect(info.names).toContain("grc.example.test");
      expect(info.selfSigned).toBe(false);
      expect(info.issuer).toBe("Example Company CA");
      const pem = (options as { cert: Buffer }).cert.toString();
      expect(pem.indexOf(readFileSync(join(work, "grc.crt"), "utf8").trim())).toBe(0);
    });

    it("accepts a .pfx with its password, and says plainly when the password is wrong or missing", () => {
      expect(prepareUpload([upload("grc.pfx")], "open sesame").info.subject).toBe("grc.example.test");
      expect(() => prepareUpload([upload("grc.pfx")], "wrong")).toThrow(/password does not open/);
      expect(() => prepareUpload([upload("grc.pfx")], "")).toThrow(/has a password/);
    });

    it("opens a key that has a password, and stores it without one", () => {
      expect(() => prepareUpload([upload("grc.crt"), upload("grc-locked.key")], "")).toThrow(/has a password/);
      const { options } = prepareUpload([upload("grc.crt"), upload("grc-locked.key")], "hunter22");
      expect((options as { key: Buffer }).key.toString()).toContain("BEGIN PRIVATE KEY");
    });

    it("refuses a missing key, a key from another certificate, and an expired certificate", () => {
      expect(() => prepareUpload([upload("grc.crt")], "")).toThrow(/private key is missing/);
      expect(() => prepareUpload([upload("grc.crt"), upload("other.key")], "")).toThrow(/does not belong/);
      const later = Date.now() + 400 * 86_400_000;
      expect(() => prepareUpload([upload("grc.crt"), upload("grc.key")], "", later)).toThrow(/expired/);
    });

    it("refuses a key too weak for browsers, in words", () => {
      execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:1024", "-nodes", "-days", "30", "-keyout", join(work, "weak.key"),
        "-out", join(work, "weak.crt"), "-subj", "/CN=weak.example.test", "-addext", "subjectAltName=DNS:weak.example.test",
      ], { stdio: "ignore" });
      expect(() => prepareUpload([upload("weak.crt"), upload("weak.key")], "")).toThrow(/too weak/);
    });

    it("refuses something that is not a certificate at all", () => {
      const junk = { name: "notes.txt", data: Buffer.from("hello").toString("base64") };
      expect(() => prepareUpload([junk], "")).toThrow(/not a certificate this can read/);
    });
  });

  describe("the Settings screen", () => {
    it("reports plain HTTP and no certificate to begin with", async () => {
      const res = await app.inject({ url: "/api/v1/settings/certificate", headers: auth() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ serving: "http", source: "none", certificate: null, restartNeeded: false });
    });

    it("is for administrators only", async () => {
      const res = await app.inject({ url: "/api/v1/settings/certificate" });
      expect(res.statusCode).toBe(401);
    });

    it("shows the warnings before saving, and saves only once they have been seen", async () => {
      const files = [upload("other.crt"), upload("other.key")];
      const first = await app.inject({
        method: "PUT", url: "/api/v1/settings/certificate", headers: auth(), payload: { files },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().needsConfirmation).toBe(true);
      expect(first.json().warnings.join(" ")).toMatch(/self-signed/);
      expect((await app.inject({ url: "/api/v1/settings/certificate", headers: auth() })).json().source).toBe("none");

      const second = await app.inject({
        method: "PUT", url: "/api/v1/settings/certificate", headers: auth(), payload: { files, confirm: true },
      });
      expect(second.statusCode).toBe(200);
      const body = second.json();
      expect(body.appliedNow).toBe(false);
      expect(body.status).toMatchObject({ source: "uploaded", serving: "http", restartNeeded: true });
      expect(body.status.certificate.subject).toBe("other.example.test");
    });

    it("never puts the key in the audit trail", async () => {
      const { rows } = await query<{ action: string; after: string }>(
        "select action, after from audit_log where entity_id = 'certificate'",
      );
      expect(rows.map((r) => r.action)).toContain("HTTPS certificate uploaded");
      expect(JSON.stringify(rows)).not.toMatch(/PRIVATE KEY/);
    });

    it("turns a bad file into a sentence, not a stack trace", async () => {
      const res = await app.inject({
        method: "PUT", url: "/api/v1/settings/certificate", headers: auth(),
        payload: { files: [upload("grc.pfx")], password: "wrong" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/password does not open/);
    });

    it("removes an uploaded certificate", async () => {
      const res = await app.inject({ method: "DELETE", url: "/api/v1/settings/certificate", headers: auth() });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toMatchObject({ source: "none", restartNeeded: false });
    });
  });

  describe("a server already on HTTPS", () => {
    let secure: FastifyInstance;
    let port = 0;

    const fingerprint = (): Promise<string> =>
      new Promise((resolve, reject) => {
        const req = httpsRequest(
          { host: "127.0.0.1", port, path: "/api/v1/health", rejectUnauthorized: false, agent: false },
          (res) => {
            resolve((res.socket as TLSSocket).getPeerX509Certificate()!.fingerprint256);
            res.resume();
          },
        );
        req.on("error", reject);
        req.end();
      });

    beforeAll(async () => {
      const first = prepareUpload([upload("other.crt"), upload("other.key")], "").options as TlsOptions;
      secure = await buildApp({ https: first });
      await secure.listen({ port: 0, host: "127.0.0.1" });
      port = (secure.server.address() as AddressInfo).port;
    });

    afterAll(async () => {
      await secure?.close();
    });

    it("redirects http:// on the same port to https://, so old links keep working", async () => {
      const res = await new Promise<{ status: number; location: string }>((resolve, reject) => {
        const req = httpRequest({ host: "127.0.0.1", port, path: "/controls?x=1", headers: { host: `grc.example.test:${port}` } }, (r) => {
          resolve({ status: r.statusCode ?? 0, location: String(r.headers.location) });
          r.resume();
        });
        req.on("error", reject);
        req.end();
      });
      expect(res).toEqual({ status: 307, location: `https://grc.example.test:${port}/controls?x=1` });
    });

    it("hands out an uploaded certificate at once, with no restart", async () => {
      const before = await fingerprint();
      const res = await app.inject({
        method: "PUT", url: "/api/v1/settings/certificate", headers: auth(),
        payload: { files: [upload("grc.pfx")], password: "open sesame", confirm: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().appliedNow).toBe(true);
      const after = await fingerprint();
      expect(after).not.toBe(before);
      expect(after).toBe(res.json().status.certificate.fingerprint);
    });
  });
});
