import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../db/pool.js";
import { canRead, canWrite, requireAuth, assertCanWrite } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";

/**
 * Programme-level settings — the things that describe the whole effort rather
 * than one control.
 *
 * A single row, id 1. What lives in `attrs` depends on the product: CSF Tiers
 * for Align, the system description and chosen baseline for Anchor. `scope` and
 * `methodology` are shared, and are what Assure's ISMS scope is written into.
 */

const patchBody = z
  .object({
    scope: z.string().max(20_000).optional(),
    methodology: z.string().max(20_000).optional(),
    attrs: z.record(z.unknown()).optional(),
  })
  .strict();

/** The row is created on demand, so a fresh install has nothing to seed. */
async function load(): Promise<Record<string, unknown>> {
  await query("insert or ignore into programme (id) values (1)");
  const { rows } = await query<{ attrs: string } & Record<string, unknown>>(
    "select * from programme where id = 1",
  );
  const row = rows[0]!;
  return { ...row, attrs: JSON.parse(row.attrs ?? "{}") };
}

export async function programmeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/programme", { preHandler: canRead }, async () => ({
    programme: await load(),
  }));

  app.patch("/api/v1/programme", { preHandler: canWrite }, async (request) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const body = patchBody.parse(request.body);

    const before = await load();

    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.scope !== undefined) {
      params.push(body.scope);
      sets.push(`scope = $${params.length}`);
    }
    if (body.methodology !== undefined) {
      params.push(body.methodology);
      sets.push(`methodology = $${params.length}`);
    }
    if (body.attrs !== undefined) {
      // Merge rather than replace, so one screen setting Tiers cannot wipe
      // another screen's system details.
      params.push(JSON.stringify(body.attrs));
      sets.push(`attrs = json_patch(attrs, $${params.length})`);
    }

    if (sets.length) {
      await query(`update programme set ${sets.join(", ")} where id = 1`, params);
    }

    const after = await load();
    await audit(request, {
      action: "Programme updated",
      entity: "programme",
      entityId: "1",
      before,
      after,
    });
    return { programme: after };
  });
}
