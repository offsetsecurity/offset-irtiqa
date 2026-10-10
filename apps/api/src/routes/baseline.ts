import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, withTransaction } from "../db/pool.js";
import { canWrite, requireAuth, assertCanWrite } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { badRequest } from "../lib/errors.js";
import { readPack, hasFeature } from "../lib/pack.js";

/**
 * Applying an SP 800-53B baseline — an Anchor-only operation.
 *
 * A baseline decides which of the 1,014 controls are in scope, so applying one
 * rewrites almost every row. That is one request, one transaction and one audit
 * entry, not a thousand of each.
 *
 * Controls outside the baseline are marked not applicable with a stated reason.
 * The reason is written only where the operator has not written their own, and
 * is cleared again if a later baseline brings the control back in scope — so
 * switching baselines never destroys someone's tailoring rationale.
 */

const AUTO_PREFIX = "Not selected in the ";
const LEVELS = ["low", "moderate", "high"] as const;
const body = z.object({ level: z.enum(LEVELS) }).strict();

interface ControlRow {
  id: string;
  ref: string;
  status: string;
  justification: string;
}

export async function baselineRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/controls/baseline", { preHandler: canWrite }, async (request) => {
    requireAuth(request);
    assertCanWrite(request.user.role);

    if (!(await hasFeature("baselines"))) {
      throw badRequest("This product does not use SP 800-53B baselines.");
    }
    const { level } = body.parse(request.body);

    const baselines = await readPack<Record<string, string[]>>("baselines.json");
    const inBaseline = new Set(baselines[level] ?? []);
    if (inBaseline.size === 0) {
      throw badRequest(`The pack has no ${level} baseline.`);
    }

    const reason = `${AUTO_PREFIX}${level} baseline (SP 800-53B).`;

    const counts = await withTransaction(async (tx) => {
      const { rows } = await tx.query<ControlRow>(
        "select id, ref, status, justification from controls",
      );

      let selected = 0;
      let excluded = 0;
      let restored = 0;

      for (const c of rows) {
        const wanted = inBaseline.has(c.ref);
        const auto = c.justification.startsWith(AUTO_PREFIX);

        if (wanted) {
          selected++;
          // Bring it back into scope only if this tool put it out of scope.
          const restore = c.status === "not_applicable" && auto;
          if (restore) restored++;
          await tx.query(
            `update controls
                set attrs = json_patch(attrs, '{"inBaseline":true}')
                    ${restore ? ", status = 'not_started', justification = ''" : ""}
              where id = $1`,
            [c.id],
          );
        } else {
          excluded++;
          // Never overwrite a rationale someone wrote themselves.
          const keep = c.justification.trim() !== "" && !auto;
          await tx.query(
            `update controls
                set attrs = json_patch(attrs, '{"inBaseline":false}'),
                    status = 'not_applicable'
                    ${keep ? "" : ", justification = $2"}
              where id = $1`,
            keep ? [c.id] : [c.id, reason],
          );
        }
      }

      await tx.query("insert or ignore into programme (id) values (1)");
      await tx.query("update programme set attrs = json_patch(attrs, $1) where id = 1", [
        JSON.stringify({ baseline: level }),
      ]);

      return { selected, excluded, restored, total: rows.length };
    });

    await audit(request, {
      action: "Baseline applied",
      entity: "programme",
      entityId: "1",
      after: { level, ...counts },
    });

    return { level, ...counts };
  });
}
