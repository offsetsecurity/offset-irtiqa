import { defineConfig } from "vitest/config";

/**
 * Config validation deliberately exits the process when the environment is
 * incomplete — that is a feature, not something to weaken for tests. So the
 * test run supplies a valid throwaway environment instead.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    /**
     * One database file, so the end-to-end suites must not run at the same
     * time: each one empties the tables it uses before it starts, and in
     * parallel they delete each other's fixtures mid-run.
     *
     * Files still get their own module registry, so each suite opens its own
     * connection and closing one does not affect the next.
     */
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      PRODUCT: "ascend",
      LOG_LEVEL: "error",
      SESSION_SECRET: "0".repeat(64),
      FIELD_ENC_KEY: "1".repeat(64),
      // Not whatever certificate the developer's own .env names: the suites
      // expect plain HTTP unless they set up HTTPS themselves.
      TLS_CERT_FILE: "",
      TLS_KEY_FILE: "",
      // The e2e suite only runs when this points at a throwaway database.
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "file:./.tmp/unit.db",
      E2E_DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/db/migrations/**"],
    },
  },
});
