import { buildApp } from "./app.js";
import { config, isLoopbackHost, product } from "./config.js";
import { captureCrashes, logStartupContext, recordCrash } from "./lib/logging.js";
import { migrate } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { seedIfEmpty } from "./db/seed.js";
import { CertificateError, loadTls } from "./tls/certificate.js";

async function main(): Promise<void> {
  // The certificate first: an uploaded one, or the files the settings name.
  // One that is configured but cannot be used stops start-up, rather than
  // quietly serving HTTP on a server everybody believes is encrypted.
  let tls: ReturnType<typeof loadTls>;
  try {
    tls = loadTls();
  } catch (err) {
    if (!(err instanceof CertificateError)) throw err;
    // eslint-disable-next-line no-console
    console.error(`${err.message}\n`);
    process.exit(1);
  }
  const https = tls?.options;

  // Refuse to put passwords on the wire.
  //
  // Answering the network without TLS means every password and session
  // cookie travels as readable text. The product used to do exactly that by
  // default. It is now a deliberate act, and one that has to be said out
  // loud: either give it a certificate, or put it behind something that has
  // one and set ALLOW_INSECURE_NETWORK.
  const exposed = !isLoopbackHost(config.HOST);
  if (exposed && !https && !config.ALLOW_INSECURE_NETWORK) {
    // eslint-disable-next-line no-console
    console.error(
      `Refusing to start.\n\n` +
        `HOST is ${config.HOST}, so this would answer other machines, and no\n` +
        `certificate is configured. Passwords and session cookies would be\n` +
        `sent as readable text across the network.\n\n` +
        `Pick one:\n\n` +
        `  HOST=127.0.0.1            only this machine can reach it (default).\n` +
        `                            Then sign in on this machine and upload a\n` +
        `                            certificate under Settings -> HTTPS certificate.\n` +
        `  TLS_CERT_FILE=... and TLS_KEY_FILE=...\n` +
        `                            serve HTTPS directly\n` +
        `  ALLOW_INSECURE_NETWORK=true\n` +
        `                            something in front of this terminates TLS\n`,
    );
    process.exit(1);
  }

  // Everything below this point creates or opens files. Refusing after that
  // would leave a database and a seeded framework pack behind on a machine
  // the product declined to run on.

  // Migrations run at boot inside BEGIN IMMEDIATE, so a second process
  // starting at the same moment waits rather than applying anything twice.
  const { applied } = await migrate();
  if (applied.length) {
    // eslint-disable-next-line no-console
    console.log(`Applied ${applied.length} migration(s) on startup.`);
  }

  // First run on an empty database: load the framework pack.
  if (await seedIfEmpty()) {
    // eslint-disable-next-line no-console
    console.log("Seeded the framework pack into an empty database.");
  }

  const app = await buildApp(https ? { https } : {});

  // From here on nothing dies quietly: an uncaught error is written to
  // crash.log before the process goes.
  captureCrashes(app.log, "app");
  logStartupContext(app.log, {
    product: product.name,
    framework: product.framework,
    port: config.PORT,
    migrationsApplied: applied.length,
  });

  await app.listen({ port: config.PORT, host: config.HOST });

  const scheme = https ? "https" : "http";
  const reach = exposed ? `every address on ${config.HOST}` : "this machine only";
  app.log.info(
    { host: config.HOST, port: config.PORT, tls: Boolean(https), certificate: tls?.source ?? "none", reachable: reach },
    `${product.name} on ${scheme}://${config.HOST}:${config.PORT} (${reach})`,
  );
  if (exposed && !https) {
    app.log.warn(
      "Answering the network without TLS of its own. Only safe if something " +
        "in front of this is terminating TLS.",
    );
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received — shutting down`);
    try {
      await app.close();
      await pool.end();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch(async (err) => {
  // No logger exists yet if this fires, so the file is written directly.
  // A start-up failure is the most likely thing a customer will ever need to
  // send us, and it is also the moment their console is about to vanish.
  recordCrash("app", "startupFailure", err);
  // eslint-disable-next-line no-console
  console.error("Failed to start:", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
