import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "../db/pool.js";
import { canRead, canWrite, requireAuth, assertCanWrite } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { config } from "../config.js";
import { deleteStored, pathOfStored, storeFile, UploadTooLarge } from "../lib/files.js";

/**
 * Files attached to register records: the signed contract on a supplier, the
 * minutes on a management review, the completion export on a training record.
 *
 * Stored exactly as evidence documents are - under a key this server made,
 * never a name the browser sent - and served the same way, always as a
 * download, so an uploaded page can never run in the product.
 */

/** The registers that take attachments, by the path their routes use, and their table. */
export const ATTACHABLE: Record<string, { table: string; label: string }> = {
  policies: { table: "policies", label: "Policy" },
  vendors: { table: "vendors", label: "Supplier" },
  training: { table: "training", label: "Training record" },
  objectives: { table: "objectives", label: "Objective" },
  parties: { table: "parties", label: "Interested party" },
  reviews: { table: "reviews", label: "Audit or review" },
  communications: { table: "communications", label: "Communication" },
  tasks: { table: "tasks", label: "Task" },
  incidents: { table: "incidents", label: "Incident" },
  findings: { table: "findings", label: "Finding" },
  assets: { table: "assets", label: "Asset" },
};

const recordParams = z.object({
  register: z.string().refine((r) => r in ATTACHABLE, "That register does not take attachments."),
  id: z.string().uuid(),
});
const fileParams = z.object({ attachmentId: z.string().uuid() });

interface AttachmentRow {
  id: string;
  entity: string;
  entity_id: string;
  file_key: string;
  file_name: string;
  file_size: number;
  file_sha256: string;
  uploaded_by: string;
  created_at: string;
}

/** What the screen is told: never the storage key. */
const present = (r: AttachmentRow) => ({
  id: r.id,
  name: r.file_name,
  size: r.file_size,
  sha256: r.file_sha256,
  uploadedBy: r.uploaded_by,
  uploadedAt: r.created_at,
});

async function recordExists(table: string, id: string): Promise<boolean> {
  const { rows } = await query(`select 1 from ${table} where id = $1`, [id]);
  return rows.length > 0;
}

/**
 * Removes every file attached to a record. Called when the record is deleted,
 * so a deleted supplier does not leave its contract behind where nothing can
 * reach it but a backup.
 */
export async function removeAttachmentsOf(table: string, id: string): Promise<void> {
  const { rows } = await query<{ file_key: string }>(
    "delete from attachments where entity = $1 and entity_id = $2 returning file_key",
    [table, id],
  );
  for (const r of rows) await deleteStored(r.file_key);
}

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/attachments/:register/:id", { preHandler: canRead }, async (request) => {
    const { register, id } = recordParams.parse(request.params);
    const { table } = ATTACHABLE[register]!;
    const { rows } = await query<AttachmentRow>(
      "select * from attachments where entity = $1 and entity_id = $2 order by created_at desc",
      [table, id],
    );
    return { attachments: rows.map(present) };
  });

  app.post("/api/v1/attachments/:register/:id", { preHandler: canWrite }, async (request, reply) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const { register, id } = recordParams.parse(request.params);
    const { table, label } = ATTACHABLE[register]!;
    if (!(await recordExists(table, id))) throw notFound(`${label} not found.`);

    const part = await request.file();
    if (!part) throw badRequest("No file was attached.");

    let stored;
    try {
      stored = await storeFile(part.file, part.filename);
    } catch (err) {
      if (err instanceof UploadTooLarge) throw badRequest(err.message);
      throw err;
    }
    if (part.file.truncated) {
      await deleteStored(stored.key);
      throw badRequest(`That file is larger than the ${config.MAX_UPLOAD_MB} MB limit.`);
    }

    const attachmentId = randomUUID();
    const { rows } = await query<AttachmentRow>(
      `insert into attachments (id, entity, entity_id, file_key, file_name, file_size, file_sha256, uploaded_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [attachmentId, table, id, stored.key, stored.name, stored.size, stored.sha256, request.user.name],
    );
    await query(
      `update ${table} set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = $1`,
      [id],
    );

    await audit(request, {
      action: `${label} file attached`,
      entity: table,
      entityId: id,
      after: { file: stored.name, bytes: stored.size, sha256: stored.sha256 },
    });
    reply.code(201);
    return { attachment: present(rows[0]!) };
  });

  /** Sent as a download, always: see the note at the top of this file. */
  app.get("/api/v1/attachments/file/:attachmentId", { preHandler: canRead }, async (request, reply) => {
    const { attachmentId } = fileParams.parse(request.params);
    const { rows } = await query<AttachmentRow>("select * from attachments where id = $1", [attachmentId]);
    const row = rows[0];
    if (!row) throw notFound("That file is no longer attached.");
    const path = await pathOfStored(row.file_key);
    if (!path) throw notFound("That file is missing from storage.");

    reply
      .header("content-type", "application/octet-stream")
      .header(
        "content-disposition",
        `attachment; filename="${row.file_name.replace(/["\\]/g, "")}"; ` +
          `filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      )
      .header("x-content-type-options", "nosniff");
    return reply.send(createReadStream(path));
  });

  app.delete("/api/v1/attachments/file/:attachmentId", { preHandler: canWrite }, async (request, reply) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const { attachmentId } = fileParams.parse(request.params);
    const { rows } = await query<AttachmentRow>(
      "delete from attachments where id = $1 returning *",
      [attachmentId],
    );
    const row = rows[0];
    if (!row) throw notFound("That file is no longer attached.");
    await deleteStored(row.file_key);

    await audit(request, {
      action: "File removed",
      entity: row.entity,
      entityId: row.entity_id,
      before: { file: row.file_name, bytes: row.file_size, sha256: row.file_sha256 },
    });
    reply.code(204);
  });
}
