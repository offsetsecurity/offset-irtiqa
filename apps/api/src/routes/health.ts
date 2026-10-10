import type { FastifyInstance } from "fastify";
import { healthcheck } from "../db/pool.js";
import { config, EDITION, product } from "../config.js";
import { APP_VERSION } from "../version.js";

const startedAt = Date.now();

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /** Liveness — is the process up. No dependencies checked. */
  app.get("/api/v1/health", async () => ({
    status: "ok",
    product: config.PRODUCT,
    name: product.name,
    edition: EDITION,
    framework: product.framework,
    version: APP_VERSION,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }));

  /** Readiness — can we actually serve traffic (database reachable). */
  app.get("/api/v1/health/ready", async (_request, reply) => {
    try {
      const db = await healthcheck();
      return { status: "ready", db };
    } catch (err) {
      reply.code(503);
      return { status: "not_ready", error: (err as Error).message };
    }
  });
}
