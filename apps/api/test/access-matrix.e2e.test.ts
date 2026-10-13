import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { seedIfEmpty } from "../src/db/seed.js";
import { pool, query } from "../src/db/pool.js";

/**
 * Every route, as every role that should not have it.
 *
 * The routes are read from the running server, not listed by hand, so a route
 * added tomorrow is tested tomorrow. Each guard says which roles it lets
 * through; every other role, and nobody signed in, must be refused. A route
 * with no guard at all must be on the short public list below, or this fails.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

/** Reachable without signing in, on purpose. Each is checked by its own suite. */
const PUBLIC = new Set([
  "GET /api/v1/health",
  "GET /api/v1/health/ready",
  "GET /api/v1/auth/bootstrap",
  "POST /api/v1/auth/bootstrap",
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/logout",
  "GET /api/v1/auth/me",
  "POST /api/v1/auth/forgot",
  "GET /api/v1/invitations/:token",
  "POST /api/v1/invitations/:token",
]);

const ROLES = ["admin", "contributor", "auditor", "readonly"] as const;
type Role = (typeof ROLES)[number];
const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SOME_ID = "00000000-0000-4000-8000-000000000000";

maybe("access to every route, by role", () => {
  const routes: { method: string; url: string; allowed: readonly string[] | null }[] = [];
  let app: FastifyInstance;
  const sessions = {} as Record<Role, { cookie: string; csrf: string }>;
  let ip = 0;

  const cookiesOf = (res: { headers: Record<string, unknown> }): { cookie: string; csrf: string } => {
    const set = res.headers["set-cookie"] as string[];
    const pairs = set.map((c) => c.split(";")[0]!);
    const csrf = pairs.find((p) => p.startsWith("offset_csrf="))!.split("=")[1]!;
    return { cookie: pairs.join("; "), csrf };
  };

  beforeAll(async () => {
    await migrate();
    await seedIfEmpty();
    for (const t of ["audit_log", "sessions", "invitations", "password_resets", "users"]) {
      await query(`delete from ${t}`).catch(() => {});
    }
    app = await buildApp({ routeTable: routes });
    await app.ready();

    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: { username: "matrix-admin", name: "Matrix Admin", email: "admin@example.test", password: "a-long-matrix-passphrase" },
    });
    sessions.admin = cookiesOf(boot);
    for (const role of ["contributor", "auditor", "readonly"] as const) {
      const made = await app.inject({
        method: "POST", url: "/api/v1/users",
        headers: { cookie: sessions.admin.cookie, "x-csrf-token": sessions.admin.csrf },
        payload: { username: `matrix-${role}`, name: `Matrix ${role}`, email: `${role}@example.test`, role, password: "a-long-matrix-passphrase" },
      });
      expect(made.statusCode, `create ${role}: ${made.body}`).toBe(201);
      const login = await app.inject({
        method: "POST", url: "/api/v1/auth/login", remoteAddress: `10.9.0.${++ip}`,
        payload: { username: `matrix-${role}`, password: "a-long-matrix-passphrase" },
      });
      expect(login.statusCode, `${role} signs in`).toBe(200);
      sessions[role] = cookiesOf(login);
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  const apiRoutes = () => routes.filter((r) => r.url.startsWith("/api/") && r.method !== "HEAD" && r.method !== "OPTIONS");
  const concrete = (url: string): string => url.replace(/:[A-Za-z]+/g, SOME_ID).replace(/\*$/, "x");

  it("finds the routes to test", () => {
    expect(apiRoutes().length).toBeGreaterThan(80);
  });

  it("has no route without a guard except the public ones", () => {
    const open = apiRoutes().filter((r) => r.allowed === null).map((r) => `${r.method} ${r.url}`);
    expect(open.filter((r) => !PUBLIC.has(r))).toEqual([]);
  });

  it("refuses every guarded route to somebody not signed in", async () => {
    for (const r of apiRoutes().filter((x) => x.allowed !== null)) {
      const res = await app.inject({ method: r.method as "GET", url: concrete(r.url), payload: WRITE.has(r.method) ? {} : undefined });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
    }
  });

  it("refuses every guarded route to each role it does not allow", async () => {
    const checked: string[] = [];
    for (const r of apiRoutes().filter((x) => x.allowed !== null)) {
      for (const role of ROLES.filter((x) => !r.allowed!.includes(x))) {
        const s = sessions[role];
        const res = await app.inject({
          method: r.method as "GET", url: concrete(r.url),
          headers: { cookie: s.cookie, "x-csrf-token": s.csrf },
          payload: WRITE.has(r.method) ? {} : undefined,
        });
        expect(res.statusCode, `${role} ${r.method} ${r.url}`).toBe(403);
        checked.push(`${role} ${r.method} ${r.url}`);
      }
    }
    expect(checked.length).toBeGreaterThan(100);
  });

  it("refuses every change made without the CSRF token, even by an administrator", async () => {
    for (const r of apiRoutes().filter((x) => x.allowed !== null && WRITE.has(x.method))) {
      const res = await app.inject({
        method: r.method as "POST", url: concrete(r.url),
        headers: { cookie: sessions.admin.cookie },
        payload: {},
      });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403);
    }
  });

  it("lets nobody but an administrator change roles, or their own", async () => {
    const me = await app.inject({ url: "/api/v1/auth/me", headers: { cookie: sessions.contributor.cookie } });
    const myId = me.json().user.id as string;
    const promote = await app.inject({
      method: "PATCH", url: `/api/v1/users/${myId}`,
      headers: { cookie: sessions.contributor.cookie, "x-csrf-token": sessions.contributor.csrf },
      payload: { role: "admin" },
    });
    expect(promote.statusCode).toBe(403);
    const still = await app.inject({ url: "/api/v1/auth/me", headers: { cookie: sessions.contributor.cookie } });
    expect(still.json().user.role).toBe("contributor");
  });
});
