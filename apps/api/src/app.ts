import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { config, isProd, logToFile, product } from "./config.js";
import { loadSession } from "./auth/session.js";
import { HttpError } from "./lib/errors.js";
import { buildLogger, REDACT } from "./lib/logging.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { controlRoutes } from "./routes/controls.js";
import { evidenceRoutes } from "./routes/evidence.js";
import { riskRoutes } from "./routes/risks.js";
import {
  assetRoutes, policyRoutes, policyAcknowledgementRoutes, taskRoutes, incidentRoutes, findingRoutes,
} from "./routes/registers.js";
import {
  vendorRoutes, trainingRoutes, objectiveRoutes, partyRoutes, reviewRoutes,
  communicationRoutes,
} from "./routes/isms.js";
import { calendarRoutes } from "./routes/calendar.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { demoRoutes } from "./routes/demo.js";
import { programmeRoutes } from "./routes/programme.js";
import { baselineRoutes } from "./routes/baseline.js";
import { journeyRoutes } from "./routes/journey.js";
import { reportRoutes } from "./routes/reports.js";
import { settingsRoutes } from "./routes/settings.js";
import { escalationRoutes } from "./routes/escalation.js";
import { jobRoutes } from "./routes/jobs.js";
import { userRoutes } from "./routes/users.js";
import { updateRoutes } from "./routes/updates.js";
import { backupRoutes } from "./routes/backups.js";
import { auditRoutes } from "./routes/audit.js";
import { certificateRoutes } from "./routes/certificate.js";
import { threadRoutes } from "./routes/thread.js";
import { templateRoutes } from "./routes/templates.js";
import { restoreInProgress } from "./backup/service.js";
import type { TlsOptions } from "./tls/certificate.js";
import { dualServerFactory } from "./tls/server.js";

/** All a session signed in with a temporary password may reach. */
const MUST_CHANGE_ALLOWED = new Set([
  "/api/v1/auth/me",
  "/api/v1/auth/logout",
  "/api/v1/auth/password",
  "/api/v1/health",
  "/api/v1/health/ready",
]);

export interface BuildOptions {
  /** When given, it serves HTTPS directly, and redirects http:// on the same port. */
  https?: TlsOptions;
  /** Filled with every route and the roles its guard allows; used by the access tests. */
  routeTable?: { method: string; url: string; allowed: readonly string[] | null }[];
}

export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  // Two shapes of the same thing. When logs go to disk we build the logger
  // ourselves, because Fastify cannot combine a pretty transport with a file
  // destination; when a developer is watching a terminal, its own pretty
  // printer is better than anything gained by writing a file nobody reads.
  //
  // Pretty printing only outside production. pino-pretty is a development
  // dependency and is not in an installed copy, so asking for it there crashed
  // the application at start the moment somebody set LOG_TO_FILE=false to let
  // journald or a container runtime collect the log. Plain JSON is what those
  // want anyway.
  const logging = logToFile
    ? { loggerInstance: buildLogger("app") }
    : {
        logger: {
          level: config.LOG_LEVEL,
          redact: REDACT,
          ...(isProd
            ? {}
            : { transport: { target: "pino-pretty", options: { colorize: true } } }),
        },
      };

  const app = Fastify({
    ...logging,
    ...(options.https ? { serverFactory: dualServerFactory(options.https) } : {}),
    // Only the proxies named in TRUST_PROXY; see config.ts for why not everyone.
    trustProxy:
      config.TRUST_PROXY === "true"
        ? true
        : config.TRUST_PROXY === "false" || config.TRUST_PROXY === ""
          ? false
          : config.TRUST_PROXY,
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 2 * 1024 * 1024,
  });

  if (options.routeTable) {
    const table = options.routeTable;
    app.addHook("onRoute", (route) => {
      const handlers = [route.preHandler].flat().filter(Boolean) as { allowed?: readonly string[] }[];
      const allowed = handlers.find((h) => Array.isArray(h.allowed))?.allowed ?? null;
      for (const method of [route.method].flat()) table.push({ method: String(method), url: route.url, allowed });
    });
  }

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        // Fonts ship with the product; nothing is fetched from elsewhere.
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cookie, { secret: config.SESSION_SECRET });

  // Uploaded evidence. The limit is declared here so the connection is cut
  // early on something enormous, and enforced again while writing, because a
  // declared limit is a promise from the client and the second one is a fact.
  await app.register(multipart, {
    limits: {
      fileSize: config.MAX_UPLOAD_MB * 1024 * 1024,
      files: 1,
      fields: 4,
    },
  });

  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: "1 minute",
  });

  // Every request gets its session resolved before the route runs. Routes then
  // declare what they require via the RBAC guards.
  app.addHook("preHandler", async (request) => {
    // While a restore swaps the data nothing else is answered, so nothing is
    // read half-restored or written into a database about to be replaced.
    if (restoreInProgress() && !request.url.startsWith("/api/v1/health")) {
      throw new HttpError(503, "A backup is being restored. Try again in a moment.");
    }
    await loadSession(request);

    // A session opened with a temporary password can do one thing: choose a
    // real password. Everything else in the API refuses until it has, so a
    // temporary password read from somebody's inbox is never a way in to the
    // data itself.
    if (request.user?.mustChangePassword) {
      const path = request.url.split("?")[0] ?? "";
      if (path.startsWith("/api/") && !MUST_CHANGE_ALLOWED.has(path)) {
        throw new HttpError(403, "Choose a new password before continuing.");
      }
    }
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof HttpError) {
      if (err.statusCode >= 500) request.log.error({ err }, err.message);
      return reply.code(err.statusCode).send({ error: err.message, detail: err.detail });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: "Invalid request.",
        detail: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    // Refusals raised by Fastify and its plugins - the rate limiter's 429, a
    // malformed body's 400 - carry their own status. Without this they all
    // became a 500 "Something went wrong", which told a rate-limited client
    // the server was broken rather than to slow down.
    const status = (err as { statusCode?: unknown }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ error: (err as Error).message });
    }
    request.log.error({ err }, "unhandled error");
    // Never leak internals to the client.
    return reply.code(500).send({ error: "Something went wrong." });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(controlRoutes);
  await app.register(evidenceRoutes);
  await app.register(riskRoutes);
  await app.register(assetRoutes);
  await app.register(policyRoutes);
  await app.register(policyAcknowledgementRoutes);
  await app.register(attachmentRoutes);
  await app.register(taskRoutes);
  await app.register(incidentRoutes);
  await app.register(findingRoutes);
  await app.register(vendorRoutes);
  await app.register(trainingRoutes);
  await app.register(objectiveRoutes);
  await app.register(partyRoutes);
  await app.register(reviewRoutes);
  await app.register(communicationRoutes);
  await app.register(calendarRoutes);
  await app.register(demoRoutes);
  await app.register(programmeRoutes);
  await app.register(journeyRoutes);
  await app.register(threadRoutes);
  await app.register(templateRoutes);
  await app.register(baselineRoutes);
  await app.register(reportRoutes);
  await app.register(settingsRoutes);
  await app.register(escalationRoutes);
  await app.register(certificateRoutes);
  await app.register(jobRoutes);
  await app.register(userRoutes);
  await app.register(updateRoutes);
  await app.register(backupRoutes);
  await app.register(auditRoutes);

  // ── the single-page app ───────────────────────────────────────────────────
  /**
   * Where the bundle is.
   *
   * Installed and in the container it sits beside the server at ../public, one
   * product per install. In development every product is built from the same
   * tree, so each gets its own folder under dist/web and this server serves
   * the one matching its own PRODUCT. Serving a shared folder meant a server
   * could end up showing another product's screens against its own API.
   *
   * WEB_DIR overrides both, for running a bundle from somewhere else entirely.
   */
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    config.WEB_DIR,
    resolve(here, "../public"),
    resolve(here, "../../../dist/web", config.PRODUCT),
  ].filter((p): p is string => Boolean(p));
  const webRoot = candidates.find((p) => existsSync(join(p, "index.html")));

  if (webRoot) {
    await app.register(fastifyStatic, {
      root: webRoot,
      // With the wildcard on, "/" resolves to the directory itself; naming the
      // index file is what makes the root path serve the app rather than fail.
      index: ["index.html"],
      // Off, so the header set below is the only one that applies. Left on,
      // the plugin's own default overwrites it.
      cacheControl: false,
      // Not `wildcard: false`. That enumerates the directory once at start-up
      // and registers a route per file, so anything written afterwards — a
      // rebuilt bundle, an in-place upgrade on the Windows track — is
      // unreachable until the process restarts, while index.html happily keeps
      // pointing at it. Serving through the wildcard resolves each request
      // against the disk instead.
      setHeaders(reply, path) {
        // The bundle name carries a content hash, so it can be cached forever.
        // index.html must not be, or the page keeps asking for a bundle that
        // no longer exists.
        //
        // `reply` is Fastify's reply since @fastify/static 10, not the raw
        // response, so it is `header()` rather than `setHeader()`.
        reply.header(
          "cache-control",
          /\.[A-Z0-9]{8}\.(js|css)(\.map)?$/.test(path)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
      },
    });
    app.log.info({ webRoot }, "serving the SPA");

    // Any non-API path returns index.html so client-side routing works on a
    // hard refresh or a deep link.
    //
    // A request that looks like a file is excluded. A missing bundle or image
    // should be an honest 404 — returning HTML in its place makes the browser
    // report a MIME type error, which says nothing about the actual problem
    // (usually a stale cached index.html pointing at a bundle that has since
    // been rebuilt under a new hash).
    const looksLikeAFile = /\.[a-z0-9]{2,8}$/i;

    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split("?")[0] ?? "";
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "No such endpoint." });
      }
      if (looksLikeAFile.test(path)) {
        return reply.code(404).send({ error: `Not found: ${path}` });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.log.warn("no web bundle found — run `pnpm --filter @offset/web build`");
    app.setNotFoundHandler((request, reply) =>
      reply.code(404).send({
        error: request.url.startsWith("/api/")
          ? "No such endpoint."
          : "Web bundle not built. Run: pnpm --filter @offset/web build",
      }),
    );
  }

  app.log.info(
    { product: config.PRODUCT, framework: product.framework },
    `${product.name} API ready`,
  );

  return app;
}
