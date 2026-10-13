import { defineConfig } from "@playwright/test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Each repository carries one product's pack; its folder name is the product id.
const packs = resolve(import.meta.dirname, "../../packs");
const product = process.env["PRODUCT"] ?? readdirSync(packs)[0]!;
const port = Number(process.env["SCREENS_PORT"] ?? 8199);
// A fresh, empty install every run, so the first-run screen is always there to test.
const data = process.env["SCREENS_DATA"] ?? mkdtempSync(join(tmpdir(), "offset-screens-"));
process.env["SCREENS_DATA"] = data;
process.env["PRODUCT"] = product;

export default defineConfig({
  testDir: "./tests",
  // One install shared by every test, in order: the first test creates the administrator.
  workers: 1,
  fullyParallel: false,
  retries: process.env["CI"] ? 1 : 0,
  timeout: 60_000,
  // A busy machine (or a shared CI runner) can take more than the default five seconds to draw a screen.
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ignoreHTTPSErrors: true,
    viewport: { width: 1360, height: 860 },
    // Locally, the Edge every Windows machine has; in CI, Playwright's own Chromium.
    ...(process.env["CI"] ? {} : { channel: "msedge" }),
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx src/server.ts",
    cwd: resolve(import.meta.dirname, "../api"),
    url: `http://127.0.0.1:${port}/api/v1/health/ready`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PRODUCT: product,
      PORT: String(port),
      PACK_DIR: resolve(packs, product),
      DATABASE_URL: `file:${join(data, "offset.db")}`,
      BACKUP_DIR: join(data, "backups"),
      EVIDENCE_DIR: join(data, "evidence"),
      LOG_TO_FILE: "true",
      LOG_DIR: join(data, "logs"),
      // Plain HTTP on this machine only, whatever a local .env says, so the
      // tests run the same here and on GitHub, where there is no certificate.
      HOST: "127.0.0.1",
      TLS_CERT_FILE: "",
      TLS_KEY_FILE: "",
      SESSION_SECRET: "0".repeat(32),
      FIELD_ENC_KEY: "1".repeat(32),
    },
  },
});
