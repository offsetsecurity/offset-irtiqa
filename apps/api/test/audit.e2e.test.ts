import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { ADDRESS_MAX_FAILED } from "../src/auth/address-limit.js";

/**
 * The audit trail screen's API, the per-address sign-in limit, and the
 * address the trail records. The last two share a file because the limit
 * counts by the address the trail writes down, and both are only worth
 * anything if a caller cannot choose it.
 */
const DB = process.env["E2E_DATABASE_URL"];
const maybe = DB ? describe : describe.skip;

maybe("audit trail", () => {
  let app: FastifyInstance;
  const sessions: Record<string, [string, string]> = {};

  const cookiesFrom = (res: { headers: Record<string, unknown> }): [string, string] => {
    let s = "", c = "";
    for (const raw of res.headers["set-cookie"] as string[]) {
      const m = /^(offset_sid|offset_csrf)=([^;]+)/.exec(raw);
      if (m?.[1] === "offset_sid") s = m[2]!;
      if (m?.[1] === "offset_csrf") c = m[2]!;
    }
    return [s, c];
  };
  const as = (who: string) => {
    const [sid, csrf] = sessions[who]!;
    return { cookie: `offset_sid=${sid}; offset_csrf=${csrf}`, "x-csrf-token": csrf };
  };
  const signIn = async (username: string, password: string) => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/auth/login", payload: { username, password },
    });
    expect(res.statusCode).toBe(200);
    sessions[username] = cookiesFrom(res);
  };
  const list = (who: string, qs = "") =>
    app.inject({ method: "GET", url: `/api/v1/audit${qs}`, headers: as(who) });

  beforeAll(async () => {
    await migrate();
    for (const t of ["audit_log", "sessions", "users"]) await query(`delete from ${t}`);
    app = await buildApp();
    await app.ready();

    const boot = await app.inject({
      method: "POST", url: "/api/v1/auth/bootstrap",
      payload: {
        username: "owner", name: "The Owner",
        email: "owner@example.test", password: "correct-horse-battery-staple",
      },
    });
    sessions["owner"] = cookiesFrom(boot);

    for (const [username, role] of [
      ["aisha", "auditor"], ["carl", "contributor"], ["rita", "readonly"],
    ] as const) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/users", headers: as("owner"),
        payload: {
          username, name: username, email: `${username}@example.test`, role,
          password: "a-long-enough-password-1",
        },
      });
      expect(res.statusCode).toBe(201);
      await signIn(username, "a-long-enough-password-1");
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("is open to administrators and auditors, and to nobody else", async () => {
    expect((await list("owner")).statusCode).toBe(200);
    expect((await list("aisha")).statusCode).toBe(200);
    expect((await list("carl")).statusCode).toBe(403);
    expect((await list("rita")).statusCode).toBe(403);
    const anonymous = await app.inject({ method: "GET", url: "/api/v1/audit" });
    expect(anonymous.statusCode).toBe(401);
    for (const url of ["/api/v1/audit/filters", "/api/v1/audit/export"]) {
      const res = await app.inject({ method: "GET", url, headers: as("carl") });
      expect(res.statusCode).toBe(403);
    }
  });

  it("lists the newest first, with a total, and pages without overlap", async () => {
    const first = (await list("owner", "?limit=3")).json();
    expect(first.entries).toHaveLength(3);
    expect(first.total).toBeGreaterThan(3);
    const ids = first.entries.map((e: { id: number }) => e.id);
    expect([...ids].sort((a: number, b: number) => b - a)).toEqual(ids);
    expect(first.next).toBe(ids[2]);

    const second = (await list("owner", `?limit=3&before=${first.next}`)).json();
    expect(second.total).toBeUndefined();
    for (const e of second.entries) expect(e.id).toBeLessThan(first.next);
  });

  it("filters by person, action, text and dates", async () => {
    const added = (await list("owner", "?action=User%20added")).json();
    expect(added.total).toBe(3);
    expect(added.entries.every((e: { action: string }) => e.action === "User added")).toBe(true);

    const byAisha = (await list("owner", "?person=aisha")).json();
    expect(byAisha.entries.length).toBeGreaterThan(0);
    expect(byAisha.entries.every((e: { person: string }) => e.person === "aisha")).toBe(true);

    const text = (await list("owner", "?q=RITA")).json();
    expect(text.entries.some((e: { label: string | null }) => e.label === "rita")).toBe(true);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await list("owner", `?from=${encodeURIComponent(future)}`)).json().total).toBe(0);
    expect((await list("owner", `?to=${encodeURIComponent(future)}`)).json().total).toBeGreaterThan(0);
  });

  it("treats wildcards typed into the search as text", async () => {
    expect((await list("owner", "?q=%25")).json().total).toBe(0);
    expect((await list("owner", "?q=_")).json().entries.every(
      (e: { action: string; person: string; label: string | null; entityId: string | null }) =>
        JSON.stringify(e).includes("_"),
    )).toBe(true);
  });

  it("says what an update changed", async () => {
    const users = await app.inject({ method: "GET", url: "/api/v1/users", headers: as("owner") });
    const rita = users.json().users.find((u: { username: string }) => u.username === "rita");
    const res = await app.inject({
      method: "PATCH", url: `/api/v1/users/${rita.id}`, headers: as("owner"),
      payload: { role: "contributor" },
    });
    expect(res.statusCode).toBe(200);

    const [entry] = (await list("owner", "?action=User%20updated&limit=1")).json().entries;
    expect(entry.person).toBe("owner");
    expect(entry.changes).toContainEqual({ field: "role", from: "readonly", to: "contributor" });
    expect(entry.changes.map((c: { field: string }) => c.field)).not.toContain("updated_at");
  });

  it("never shows anything that looks like a secret, whatever wrote it", async () => {
    await query(
      `insert into audit_log (actor_name, action, entity, after) values ('system', 'Synthetic', 'settings', $1)`,
      [JSON.stringify({ name: "shown", password: "p1", smtp_pass: "p2", nested: { apiKey: "p3", totp_secret: "p4" } })],
    );
    const [entry] = (await list("owner", "?action=Synthetic")).json().entries;
    expect(entry.after).toEqual({
      name: "shown", password: "[hidden]", smtp_pass: "[hidden]",
      nested: { apiKey: "[hidden]", totp_secret: "[hidden]" },
    });
    const csv = await app.inject({ method: "GET", url: "/api/v1/audit/export?action=Synthetic", headers: as("owner") });
    expect(csv.body).not.toMatch(/p1|p2|p3|p4/);
  });

  it("downloads as CSV, defuses formulas, and records that it was downloaded", async () => {
    await query(
      `insert into audit_log (actor_name, action, entity_id) values ('system', '=HYPERLINK("http://x")', '+cmd')`,
    );
    const res = await app.inject({ method: "GET", url: "/api/v1/audit/export", headers: as("aisha") });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="audit-trail-\d{4}-\d\d-\d\d\.csv"/);
    const lines = res.body.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("When (UTC),Person,Action,Record type,Record,Address,Changes,Before,After");
    expect(res.body).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(res.body).toContain("'+cmd");

    const [latest] = (await list("owner", "?limit=1")).json().entries;
    expect(latest.action).toBe("Audit trail downloaded");
    expect(latest.person).toBe("aisha");
  });

  it("offers every person and action for the filter lists", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/audit/filters", headers: as("aisha") });
    expect(res.statusCode).toBe(200);
    const f = res.json();
    expect(f.people).toEqual(expect.arrayContaining(["owner", "aisha"]));
    expect(f.actions).toContain("Signed in");
    expect(f.retentionDays).toBe(0);
  });

  it("has no way to change or delete an entry", async () => {
    const [entry] = (await list("owner", "?limit=1")).json().entries;
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const res = await app.inject({ method, url: `/api/v1/audit/${entry.id}`, headers: as("owner"), payload: {} });
      expect([404, 405]).toContain(res.statusCode);
    }
  });

  describe("the address it records", () => {
    it("is the caller's own, not one a caller names", async () => {
      await app.inject({
        method: "POST", url: "/api/v1/auth/login", remoteAddress: "10.9.9.9",
        headers: { "x-forwarded-for": "203.0.113.7" },
        payload: { username: "nobody-spoof", password: "x" },
      });
      const [entry] = (await list("owner", "?q=nobody-spoof")).json().entries;
      expect(entry.ip).toBe("10.9.9.9");
    });

    it("comes from a proxy on this machine, which is trusted", async () => {
      await app.inject({
        method: "POST", url: "/api/v1/auth/login", remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-for": "203.0.113.8" },
        payload: { username: "nobody-proxied", password: "x" },
      });
      const [entry] = (await list("owner", "?q=nobody-proxied")).json().entries;
      expect(entry.ip).toBe("203.0.113.8");
    });
  });

  describe("the limit on failed sign-ins from one address", () => {
    const attempt = (address: string, username: string, password: string) =>
      app.inject({
        method: "POST", url: "/api/v1/auth/login", remoteAddress: address,
        payload: { username, password },
      });

    it("refuses an address after too many failures, even with the right password", async () => {
      for (let i = 0; i < ADDRESS_MAX_FAILED; i++) {
        expect((await attempt("10.1.1.1", `guess-${i}`, "wrong")).statusCode).toBe(401);
      }
      const blocked = await attempt("10.1.1.1", "owner", "correct-horse-battery-staple");
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error ?? blocked.body).toMatch(/Too many failed sign-ins from this address/);

      const marks = (await list("owner", "?action=Sign-in%20blocked%20for%20this%20address")).json();
      expect(marks.total).toBe(1);
      expect(marks.entries[0].ip).toBe("10.1.1.1");
    });

    it("leaves every other address alone", async () => {
      expect((await attempt("10.1.1.2", "owner", "correct-horse-battery-staple")).statusCode).toBe(200);
    });

    it("does not count successful sign-ins", async () => {
      for (let i = 0; i < ADDRESS_MAX_FAILED + 5; i++) {
        expect((await attempt("10.1.1.3", "aisha", "a-long-enough-password-1")).statusCode).toBe(200);
      }
    });

    it("stops a blocked address from locking anyone's account", async () => {
      for (let i = 0; i < 10; i++) await attempt("10.1.1.1", "aisha", "wrong");
      const row = await query<{ failed_logins: number }>("select failed_logins from users where username = 'aisha'");
      expect(row.rows[0]!.failed_logins).toBe(0);
    });
  });
});
