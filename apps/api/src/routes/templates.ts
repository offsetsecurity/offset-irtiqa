import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canRead, canWrite, requireAuth, assertCanWrite } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { saveStored, type Stored } from "../templates/answers.js";
import { CONTENT_TYPE, fillAll, fillOne, load, zipOf } from "../templates/documents.js";

/**
 * Filling in the policy templates inside the product.
 *
 * The answers are asked once: company facts and usual choices shared by every
 * document, a few questions per document, and the rest comes from the
 * registers. A download is the pack's template with all of that put in, and
 * anything still unanswered left yellow for Word.
 */

const MAX_TEXT = 5_000;

const body = z
  .object({
    values: z.record(z.string().max(MAX_TEXT)).default({}),
    lists: z.record(z.array(z.array(z.string().max(MAX_TEXT)).max(20)).max(100)).default({}),
  })
  .strict();

const fileParam = z.object({ file: z.string().regex(/^[\w.-]+\.(docx|xlsx)$/) });

const attachment = (name: string): string => `attachment; filename="${name.replace(/[^\w.-]/g, "_")}"`;

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  /** The questions, the answers so far, and how much of each document is filled. */
  app.get("/api/v1/templates", { preHandler: canRead }, async () => {
    const l = await load();
    if (!l) throw notFound("This product's templates cannot be filled in here.");
    const filled = await fillAll(l);
    return {
      manifest: l.manifest,
      answers: l.stored,
      known: l.known.derived,
      counts: Object.fromEntries(
        Object.entries(l.known.sources).map(([k, rows]) => [k, rows.length]),
      ),
      status: filled.map((f) => ({ file: f.file, left: f.left, total: f.total })),
    };
  });

  app.put("/api/v1/templates/answers", { preHandler: canWrite }, async (request) => {
    requireAuth(request);
    assertCanWrite(request.user.role);
    const parsed = body.parse(request.body);
    const l = await load();
    if (!l) throw notFound("This product's templates cannot be filled in here.");

    // Only names the templates use, so a typo cannot quietly store nothing useful.
    const known = new Set<string>(l.manifest.shared.map((s) => s.name));
    const lists = new Set<string>();
    for (const d of l.manifest.documents) {
      for (const k of Object.keys(d.fields)) known.add(k);
      for (const item of d.items) if (item["t"] === "list") lists.add(String(item["id"]));
    }
    const strange = [...Object.keys(parsed.values).filter((k) => !known.has(k)),
      ...Object.keys(parsed.lists).filter((k) => !lists.has(k))];
    if (strange.length) throw badRequest(`The templates have no blank called ${strange.join(", ")}.`);

    const after: Stored = {
      // An empty answer is no answer: the usual one applies.
      values: Object.fromEntries(
        Object.entries(parsed.values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v),
      ),
      // A row with nothing in it is not a row.
      lists: Object.fromEntries(Object.entries(parsed.lists).map(([k, rows]) => [
        k, rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean)),
      ])),
    };
    await saveStored(after);
    await audit(request, {
      action: "Template answers saved",
      entity: "settings",
      entityId: "templates",
      before: l.stored,
      after,
    });
    const now = await load();
    const filled = await fillAll(now!);
    return {
      answers: after,
      status: filled.map((f) => ({ file: f.file, left: f.left, total: f.total })),
    };
  });

  app.get("/api/v1/templates/filled/:file", { preHandler: canRead }, async (request, reply) => {
    requireAuth(request);
    const { file } = fileParam.parse(request.params);
    const l = await load();
    const doc = l?.manifest.documents.find((d) => d.file === file);
    if (!l || !doc) throw notFound("There is no such template.");
    const filled = await fillOne(doc, l);
    return reply
      .header("content-type", CONTENT_TYPE[file.split(".").pop()!]!)
      .header("content-disposition", attachment(file))
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "no-store")
      .send(filled.data);
  });

  app.get("/api/v1/templates/filled.zip", { preHandler: canRead }, async (request, reply) => {
    requireAuth(request);
    const l = await load();
    if (!l) throw notFound("This product's templates cannot be filled in here.");
    const files = await fillAll(l);
    await audit(request, { action: "Filled templates downloaded", entity: "settings", entityId: "templates" });
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", attachment("ISMS_documents.zip"))
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "no-store")
      .send(zipOf(files));
  });
}
