import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canRead, isAdmin, requireAuth } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { todayIso } from "../lib/time.js";
import { loadSmtp, whyNotSendable } from "../mail/mailer.js";
import {
  CHAIN_REPEAT_DAYS, CHAIN_ROLES, loadEscalation, recentLog, saveEscalation, sendReminders,
} from "../mail/escalation.js";
import { REMIND_BEFORE } from "../mail/reminders.js";

/**
 * The Escalation screen: whether reminders go out on their own, who is told
 * when something is overdue, and a record of everything that has been sent.
 */

const level = z
  .object({
    name: z.string().trim().max(120).default(""),
    // Empty is allowed: a level with no address is simply skipped.
    email: z.union([z.literal(""), z.string().trim().email("That is not an email address.")]).default(""),
    days: z.coerce.number().int("Days overdue must be a whole number.").min(1, "Days overdue starts at 1.").max(365),
  })
  .strict();

const body = z
  .object({
    enabled: z.boolean(),
    chain: z.array(level).length(CHAIN_ROLES.length, `There are ${CHAIN_ROLES.length} levels.`),
  })
  .strict();

export async function escalationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/escalation", { preHandler: canRead }, async () => {
    const settings = await loadEscalation();
    const blocked = whyNotSendable(await loadSmtp());
    return {
      escalation: settings,
      schedule: { before: REMIND_BEFORE, repeatDays: CHAIN_REPEAT_DAYS },
      emailReady: blocked === null,
      emailProblem: blocked,
    };
  });

  app.put("/api/v1/escalation", { preHandler: isAdmin }, async (request) => {
    requireAuth(request);
    const parsed = body.parse(request.body);
    const before = await loadEscalation();
    const after = {
      enabled: parsed.enabled,
      chain: CHAIN_ROLES.map((r, i) => ({ role: r.role, ...parsed.chain[i]! })),
    };
    await saveEscalation(after);
    await audit(request, {
      action: after.enabled ? "Reminders on, escalation saved" : "Reminders turned off",
      entity: "settings",
      entityId: "escalation",
      before,
      after,
    });
    return { escalation: after };
  });

  app.get("/api/v1/escalation/log", { preHandler: canRead }, async (request) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(100) }).parse(request.query);
    return { log: await recentLog(q.limit) };
  });

  /** Sends whatever is due today without waiting for the nightly job. Nothing goes out twice. */
  app.post("/api/v1/escalation/run", { preHandler: isAdmin }, async (request) => {
    requireAuth(request);
    const result = await sendReminders(todayIso(), { force: true });
    await audit(request, {
      action: "Reminders run by hand",
      entity: "settings",
      entityId: "escalation",
      after: { owner: result.owner, chain: result.chain, failed: result.failed },
    });
    return { result };
  });
}
