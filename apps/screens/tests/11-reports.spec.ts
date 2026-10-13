import { test, expect } from "@playwright/test";
import { signIn, open, has } from "./support.js";

/**
 * Reports laid out by reader, in the products with the board paper: the two
 * papers first, then the detail, each with who last took a copy.
 */
test.beforeEach(async ({ page }) => {
  test.skip(!has("boardReport"), "This product keeps the plain Reports layout.");
  await signIn(page);
});

test("the board paper and the plan lead, and the rest are grouped by who reads them", async ({ page }) => {
  await open(page, "reports");
  await expect(page.locator(".rb-feature h2")).toHaveText(["Executive summary", "Readiness plan"]);
  await expect(page.locator(".rb-feature .rb-kicker")).toHaveText(["For the board", "For management"]);
  await expect(page.locator(".rb-group-h").first()).toContainText("For your auditor");
  await expect(page.locator(".rb-group-h").last()).toContainText("For the management system");
  await expect(page.locator(".rb-row").filter({ hasText: "Risk register" })).toHaveCount(1);
});

test("downloading a report says who took it, and the board paper is a PDF", async ({ page }) => {
  await open(page, "reports");
  const card = page.locator(".rb-feature").filter({ hasText: "Executive summary" });
  const [download] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: /Download Executive summary/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^executive-summary-\d{4}-\d{2}-\d{2}\.pdf$/);
  const bytes = Buffer.concat(await (await download.createReadStream()).toArray());
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  await expect(card.locator(".rb-last")).toHaveText(/^Last downloaded by .+, today$/);
});

test("Download all gives one zip with every report in it", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, "reports");
  const count = await page.locator(".rb-feature, .rb-row").count();
  const button = page.getByRole("button", { name: /Download all/ });
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), button.click()]);
  expect(download.suggestedFilename()).toMatch(/^reports-\d{4}-\d{2}-\d{2}\.zip$/);
  const zip = Buffer.concat(await (await download.createReadStream()).toArray());
  expect(zip.subarray(0, 4).toString("latin1")).toBe("PK\u0003\u0004");
  // One local header per report, each a PDF.
  expect((zip.toString("latin1").match(/PK\u0003\u0004/g) ?? []).length).toBe(count);
  expect((zip.toString("latin1").match(/%PDF-/g) ?? []).length).toBe(count);
  await expect(button).toHaveText(/Download all/);
});

test("an administrator names the organisation for the cover", async ({ page }) => {
  await open(page, "reports");
  // A new name each run: the screens database keeps what earlier runs saved.
  const name = `Screens Test Company ${Date.now()}`;
  const input = page.getByLabel("Organisation name");
  await input.fill(name);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("button", { name: "Save name" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Organisation name")).toHaveValue(name);
});
