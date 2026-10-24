import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { resetAddressLimits } from "../src/auth/address-limit.js";
import { seedControls } from "../src/db/seed.js";

/**
 * Findings from the security audit of 24 October 2026, one test each.
 *
 * These run over a real socket rather than app.inject, because the first of
 * them is about what Node will and will not put in a response header, and
 * only a real response checks that.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

const PASSWORD = "correct-horse-battery-staple";

maybe("security audit findings", () => {
  let app: FastifyInstance;
  let base = "";
  let cookie = "";
  let csrf = "";

  const signIn = async (username: string, password: string) =>
    fetch(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        cookie,
        "x-csrf-token": csrf,
        ...(body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });

  const uploadAndFetch = async (name: string): Promise<Response> => {
    const evidence = (await (await send("POST", "/api/v1/evidence", { name: `Evidence for ${name}` })).json()) as { evidence: { id: string } };
    const form = new FormData();
    form.append("file", new Blob(["%PDF-1.4 test"]), name);
    const up = await send("POST", `/api/v1/evidence/${evidence.evidence.id}/file`, form);
    expect(up.status).toBe(201);
    return send("GET", `/api/v1/evidence/${evidence.evidence.id}/file`);
  };

  beforeAll(async () => {
    await migrate();
    for (const t of ["audit_log", "sessions", "users"]) await query(`delete from ${t}`);
    resetAddressLimits();
    // Other suites empty the controls table; this one links to a control.
    await seedControls();
    app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

    const boot = await fetch(`${base}/api/v1/auth/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "keeper", name: "The Keeper", email: "keeper@example.test", password: PASSWORD }),
    });
    expect(boot.status).toBe(201);
    const jar = boot.headers.getSetCookie().map((c) => c.split(";")[0]!);
    cookie = jar.join("; ");
    csrf = jar.find((c) => c.startsWith("offset_csrf="))!.slice("offset_csrf=".length);
  }, 60_000);

  afterAll(async () => {
    resetAddressLimits();
    await app?.close();
    await pool.end();
  });

  // SEC-001
  it.each([
    ["Arabic", "تقرير المراجعة.pdf"],
    ["Chinese", "审计报告.pdf"],
    ["Hindi", "रिपोर्ट.pdf"],
    ["an emoji", "report ✅.pdf"],
    ["accented Latin", "résumé.pdf"],
  ])("downloads a file whose name is in %s, under its real name", async (_script, name) => {
    const res = await uploadAndFetch(name);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("%PDF-1.4 test");
    const disposition = res.headers.get("content-disposition")!;
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent(name)}`);
    // The quoted fallback carries only characters every client can read.
    expect(/filename="([^"]*)"/.exec(disposition)![1]).toMatch(/^[\x20-\x7e]+$/);
  });

  // SEC-001, the same header on a register record's files
  it("downloads a supplier's file with an Arabic name", async () => {
    const vendor = (await (await send("POST", "/api/v1/vendors", { name: "مورد الرواتب" })).json()) as { vendor: { id: string } };
    const form = new FormData();
    form.append("file", new Blob(["contract"]), "العقد.pdf");
    const up = (await (await send("POST", `/api/v1/attachments/vendors/${vendor.vendor.id}`, form)).json()) as { attachment: { id: string } };
    const res = await send("GET", `/api/v1/attachments/file/${up.attachment.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(`filename*=UTF-8''${encodeURIComponent("العقد.pdf")}`);
  });

  // SEC-008
  it("refuses a link to a control that does not exist, and an endless list of them", async () => {
    const risk = { title: `Linked to nothing ${crypto.randomUUID()}`, likelihood: 2, impact: 2 };
    const unknown = await send("POST", "/api/v1/risks", { ...risk, controlIds: [crypto.randomUUID()] });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: string }).error).toMatch(/no longer exists/);

    const tooMany = await send("POST", "/api/v1/risks", {
      ...risk, controlIds: Array.from({ length: 501 }, () => crypto.randomUUID()),
    });
    expect(tooMany.status).toBe(400);
  });

  // zod 4 applies defaults inside .partial(); an update must not.
  it("leaves alone every field an update does not mention", async () => {
    const control = (await query<{ id: string }>("select id from controls order by ref limit 1")).rows[0]!.id;
    const run = crypto.randomUUID().slice(0, 8);
    const created = (await (await send("POST", "/api/v1/risks", {
      title: `Kept as it was ${run}`, likelihood: 3, impact: 4, status: "Treated", treatment: "Accept", controlIds: [control],
    })).json()) as { risk: { id: string } };
    const res = await send("PATCH", `/api/v1/risks/${created.risk.id}`, { title: `Renamed only ${run}` });
    expect(res.status).toBe(200);
    const risk = ((await (await send("GET", `/api/v1/risks/${created.risk.id}`)).json()) as {
      risk: { title: string; status: string; treatment: string; controlIds?: string[]; controls?: unknown[] };
    }).risk;
    expect(risk).toMatchObject({ title: `Renamed only ${run}`, status: "Treated", treatment: "Accept" });
    expect(JSON.stringify(risk)).toContain(control);
  });

  // SEC-015
  it("turns off camera, microphone and location for the page", async () => {
    const policy = (await fetch(`${base}/`)).headers.get("permissions-policy") ?? "";
    for (const feature of ["camera=()", "microphone=()", "geolocation=()"]) expect(policy).toContain(feature);
  });

  // SEC-006
  it("takes as long to refuse a made-up username as a real one", async () => {
    const median = async (username: string): Promise<number> => {
      const times: number[] = [];
      for (let i = 0; i < 6; i++) {
        const start = performance.now();
        await signIn(username, "not-the-password");
        times.push(performance.now() - start);
      }
      return times.sort((a, b) => a - b)[3]!;
    };
    // Warm the stand-in hash, which is made on first use.
    await signIn("nobody-at-all", "x");
    const real = await median("keeper");
    const madeUp = await median("nobody-at-all");
    // Both pay for one Argon2id check. Before the fix the made-up name came
    // back about twenty times faster.
    expect(madeUp).toBeGreaterThan(real * 0.5);
    await query("update users set failed_logins = 0, locked_until = null");
    resetAddressLimits();
  });

  // SEC-007
  it("does not keep what was typed as a username when no such account exists", async () => {
    await signIn("MySecretPassw0rd!", "whatever");
    const { rows } = await query<{ after: string | null; entity_id: string | null }>(
      "select after, entity_id from audit_log where action = 'Login failed' order by id desc limit 1",
    );
    expect(JSON.stringify(rows[0])).not.toContain("MySecretPassw0rd!");
    expect(JSON.stringify(rows[0])).toContain("unknown user");
    resetAddressLimits();
  });
});
