import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { isAdmin, requireAuth } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { badRequest } from "../lib/errors.js";
import { APP_VERSION } from "../version.js";
import { ReleaseError } from "../update/release.js";
import {
  checkForUpdates, currentStatus, lastCheck, requestUpdate, updaterState, usingCustomKeys,
} from "../update/service.js";

/**
 * Settings → Updates. Administrators only, all of it.
 *
 * Even reading is restricted: the version a server runs, and whether it is
 * behind, is exactly what somebody choosing which known flaw to try first
 * would like to know.
 */

const applyBody = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict();

export async function updateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/updates", { preHandler: isAdmin }, async () => ({
    current: APP_VERSION,
    product: config.PRODUCT,
    installKind: config.INSTALL_KIND,
    updater: await updaterState(),
    lastCheck: await lastCheck(),
    status: await currentStatus(),
    customKeys: usingCustomKeys(),
  }));

  /** Contacts the update server. Only ever because an administrator asked. */
  app.post("/api/v1/updates/check", { preHandler: isAdmin }, async () => ({
    lastCheck: await checkForUpdates(),
  }));

  app.post("/api/v1/updates/apply", { preHandler: isAdmin }, async (request, reply) => {
    requireAuth(request);
    const { version } = applyBody.parse(request.body);

    let queued;
    try {
      queued = await requestUpdate(version, request.user.username);
    } catch (err) {
      if (err instanceof ReleaseError) throw badRequest(err.message);
      throw err;
    }

    await audit(request, {
      action: "Update requested",
      entity: "update",
      entityId: queued.id,
      before: { version: APP_VERSION },
      after: { version: queued.version, backup: queued.backup },
    });

    reply.code(202);
    return { request: queued };
  });
}
