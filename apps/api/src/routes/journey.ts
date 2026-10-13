import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../db/pool.js";
import { canRead, canWrite, requireAuth, assertCanWrite } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { hasFeature } from "../lib/pack.js";
import { buildJourney, findTask } from "../journey/journey.js";

/**
 * The readiness journey.
 *
 * Only products whose pack ships a journey have this; the rest 404, the same
 * way the Statement of Applicability does. A customer should not be offered a
 * plan for a framework they are not using.
 */

const putBody = z
  .object({
    state: z.enum(["done", "not_applicable", "outstanding"]),
    reason: z.string().max(2_000).default(""),
    /** Who is doing it, and where to chase them. Both optional, and useless apart. */
    owner: z.string().max(200).optional(),
    ownerEmail: z.union([z.literal(""), z.string().email("That is not an email address.")]).optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "A due date must look like 2026-03-31.")
      .nullable()
      .optional(),
  })
  .strict();

const idParam = z.object({ taskId: z.string().max(120) });

/** Refuses the whole feature where the pack has no plan to show. */
async function requireJourney(): Promise<void> {
  if (!(await hasFeature("journey"))) throw notFound("This product has no readiness plan.");
}

export async function journeyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/journey", { preHandler: canRead }, async () => {
    await requireJourney();
    return { journey: await buildJourney() };
  });

  app.put("/api/v1/journey/:taskId", { preHandler: canWrite }, async (request) => {
    await requireJourney();
    requireAuth(request);
    assertCanWrite(request.user.role);

    const { taskId } = idParam.parse(request.params);
    const body = putBody.parse(request.body);

    // Only tasks the pack actually defines. Without this the table quietly
    // fills with ids from a previous version of the plan, or from a typo.
    const task = await findTask(taskId);
    if (!task) throw notFound("No such task in the plan.");

    /**
     * A task the product checks for itself cannot be ticked by hand.
     *
     * The check decides, so a stored tick would sit in the table changing
     * nothing while the caller believed it had worked. Refusing says so.
     * Excluding such a task is still allowed and still wins over the check —
     * that is the customer telling us the question does not apply to them,
     * which is a different claim from "I have done it".
     */
    if (task.check && body.state === "done") {
      throw badRequest(
        "This step is checked against your own data, so it cannot be ticked by hand. " +
          "Do the work and it turns green on its own, or exclude it if it does not apply to you.",
      );
    }

    /**
     * Ruling something out needs a reason.
     *
     * This is the one place a customer can take work off their own plan, and
     * an exclusion nobody can explain is the single easiest thing for an
     * assessor to pull apart. Asking at the moment they decide costs them a
     * sentence; asking six months later costs them the argument.
     */
    if (body.state === "not_applicable" && !body.reason.trim()) {
      throw badRequest("Say why this does not apply to you.");
    }

    const before = (await query("select * from journey_tasks where task_id = $1", [taskId])).rows[0];

    /**
     * An owner and a date survive going back to outstanding.
     *
     * "Outstanding" is the normal state of a step somebody has been given and
     * has not finished, so deleting the row there would throw away exactly the
     * assignment that makes it worth chasing. The row is only removed when it
     * carries nothing else worth keeping.
     */
    const assignment = {
      owner: body.owner ?? before?.["owner"] ?? "",
      ownerEmail: body.ownerEmail ?? before?.["owner_email"] ?? "",
      dueDate: body.dueDate !== undefined ? body.dueDate : (before?.["due_date"] ?? null),
    };
    const assigned = Boolean(assignment.owner || assignment.ownerEmail || assignment.dueDate);

    if (body.state === "outstanding" && !assigned) {
      await query("delete from journey_tasks where task_id = $1", [taskId]);
    } else if (body.state === "outstanding") {
      await query(
        `insert into journey_tasks (task_id, state, reason, actor_name, owner, owner_email, due_date, updated_at)
         values ($1, 'outstanding', '', $2, $3, $4, $5, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         on conflict (task_id) do update set
           state = 'outstanding', reason = '', owner = excluded.owner,
           owner_email = excluded.owner_email, due_date = excluded.due_date,
           actor_name = excluded.actor_name, updated_at = excluded.updated_at`,
        [
          taskId,
          request.user.name || request.user.username,
          assignment.owner,
          assignment.ownerEmail,
          assignment.dueDate,
        ],
      );
    } else {
      await query(
        `insert into journey_tasks (task_id, state, reason, actor_name, updated_at)
         values ($1, $2, $3, $4, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         on conflict (task_id) do update set
           state = excluded.state,
           reason = excluded.reason,
           actor_name = excluded.actor_name,
           updated_at = excluded.updated_at`,
        [
          taskId,
          body.state,
          body.state === "not_applicable" ? body.reason.trim() : "",
          request.user.name || request.user.username,
        ],
      );
    }

    const after = (await query("select * from journey_tasks where task_id = $1", [taskId])).rows[0];

    await audit(request, {
      action: body.state === "not_applicable" ? "Plan task excluded" : "Plan task updated",
      entity: "journey_task",
      entityId: taskId,
      before: before ?? null,
      after: after ?? null,
    });

    return { journey: await buildJourney() };
  });
}
