import type { FastifyInstance } from "fastify";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { isAdmin, requireAuth } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { badRequest } from "../lib/errors.js";
import { query } from "../db/pool.js";
import {
  acceptUpload, BackupError, backupDir, backupPath, createBackup, deleteBackup, listBackups,
  pruneBackups, restoreBackup,
} from "../backup/service.js";

/**
 * The Backups screen. Administrators only, every route.
 *
 * A backup holds every account's password hash and every document in the
 * product, so downloading one is as sensitive as anything here.
 */

const nameParam = z.object({ name: z.string().max(120) });
const restoreBody = z.object({ confirm: z.literal("RESTORE") }).strict();

/** Uploads can be much larger than an evidence document: a backup carries all of them. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

const translate = (err: unknown): never => {
  if (err instanceof BackupError) throw badRequest(err.message);
  throw err;
};

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/backups", { preHandler: isAdmin }, async () => ({ backups: await listBackups() }));

  app.post("/api/v1/backups", { preHandler: isAdmin }, async (request, reply) => {
    requireAuth(request);
    const backup = await createBackup("manual");
    await pruneBackups([backup.name]);
    await audit(request, { action: "Backup taken", entity: "backup", entityId: backup.name, after: backup });
    reply.code(201);
    return { backup };
  });

  app.get("/api/v1/backups/:name/download", { preHandler: isAdmin }, async (request, reply) => {
    requireAuth(request);
    const { name } = nameParam.parse(request.params);
    const path = await backupPath(name).catch(translate);
    await audit(request, { action: "Backup downloaded", entity: "backup", entityId: name });
    return reply
      .header("content-type", "application/octet-stream")
      .header("content-disposition", `attachment; filename="${name}"`)
      .header("x-content-type-options", "nosniff")
      .send(createReadStream(path));
  });

  app.post("/api/v1/backups/upload", { preHandler: isAdmin }, async (request, reply) => {
    requireAuth(request);
    const file = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
    if (!file) throw badRequest("Choose a backup file to upload.");

    await mkdir(backupDir(), { recursive: true });
    const partial = join(backupDir(), `.upload-${Date.now()}-${Math.random().toString(36).slice(2)}.partial`);
    try {
      await pipeline(file.file, createWriteStream(partial));
      if (file.file.truncated) throw badRequest("That file is too large to be a backup.");
    } catch (err) {
      await rm(partial, { force: true });
      throw err;
    }

    const backup = await acceptUpload(partial).catch(translate);
    await pruneBackups([backup.name]);
    await audit(request, { action: "Backup uploaded", entity: "backup", entityId: backup.name, after: backup });
    reply.code(201);
    return { backup };
  });

  app.post("/api/v1/backups/:name/restore", { preHandler: isAdmin }, async (request) => {
    requireAuth(request);
    const { name } = nameParam.parse(request.params);
    restoreBody.parse(request.body);
    const actor = { id: request.user.id, username: request.user.username };

    const result = await restoreBackup(name).catch(translate);

    // Written into the restored database, so the trail says what happened to
    // it. The actor's account may not exist in the backup, hence no id.
    await query(
      `insert into audit_log (actor_id, actor_name, ip, action, entity, entity_id, after, request_id)
       values (null, $1, $2, 'Backup restored', 'backup', $3, $4, $5)`,
      [actor.username, request.ip, name, JSON.stringify(result), request.id],
    );
    return { result, signedOut: true };
  });

  app.delete("/api/v1/backups/:name", { preHandler: isAdmin }, async (request, reply) => {
    requireAuth(request);
    const { name } = nameParam.parse(request.params);
    await deleteBackup(name).catch(translate);
    await audit(request, { action: "Backup deleted", entity: "backup", entityId: name });
    reply.code(204);
  });
}

