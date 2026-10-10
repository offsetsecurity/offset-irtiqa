import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canRead } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { notFound } from "../lib/errors.js";
import { packMeta } from "../lib/pack.js";
import { REPORTS, renderReport } from "../reports/definitions.js";

/**
 * Reports.
 *
 * Reading, so an auditor can export without being able to change anything —
 * but every export still writes an audit row. "Who took a copy of the
 * Statement of Applicability, and when" is a question worth being able to
 * answer.
 */

const idParam = z.object({ id: z.string().max(60) });

/** Only offer what this product's framework actually has. */
async function available(): Promise<typeof REPORTS> {
  const features = (await packMeta()).features ?? {};
  return REPORTS.filter((r) => !r.requires || features[r.requires]);
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/reports", { preHandler: canRead }, async () => {
    // A scored framework changes what a couple of these reports contain, so it
    // changes what they say they contain.
    const scored = Boolean((await packMeta()).features?.["maturity"]);
    return {
      reports: (await available()).map((r) => ({
        id: r.id,
        title: r.title,
        description: (scored && r.scoredDescription) || r.description,
      })),
    };
  });

  app.get("/api/v1/reports/:id", { preHandler: canRead }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const spec = (await available()).find((r) => r.id === id);
    if (!spec) throw notFound("No such report.");

    const who = request.user?.name ?? request.user?.username ?? "unknown";
    const pdf = await renderReport(spec, who);

    await audit(request, {
      action: "Report generated",
      entity: "report",
      entityId: spec.id,
      after: { title: spec.title, bytes: pdf.length },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${spec.id}-${stamp}.pdf`;

    return reply
      .header("content-type", "application/pdf")
      // `attachment` is what makes the browser download rather than display it.
      .header("content-disposition", `attachment; filename="${filename}"`)
      .header("content-length", String(pdf.length))
      .header("cache-control", "no-store")
      .send(pdf);
  });
}
