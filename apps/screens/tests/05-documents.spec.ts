import { test, expect } from "@playwright/test";
import { signIn, open, has } from "./support.js";

test.beforeEach(async ({ page }) => { await signIn(page); });

/** Opens Policies → Templates and waits for the list, so a slow load is not mistaken for "no templates". */
async function openTemplates(page: import("@playwright/test").Page): Promise<number> {
  await open(page, "policies");
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".content").getByText("Loading…", { exact: true })).toHaveCount(0);
  return page.getByRole("button", { name: "Fill in", exact: true }).count();
}

test("Policies has a Templates tab with documents to fill in", async ({ page }) => {
  test.skip(!has("policyTemplates"), "No templates in this product.");
  test.skip(await openTemplates(page) === 0, "This product's templates are not fillable yet.");
  await expect(page.getByRole("button", { name: "Fill in", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Download filled" }).first()).toBeVisible();
});

test("Fill in opens the questions, starting with the company's details", async ({ page }) => {
  test.skip(!has("policyTemplates"), "No templates in this product.");
  test.skip(await openTemplates(page) === 0, "This product's templates are not fillable yet.");
  await page.getByRole("button", { name: "Fill in", exact: true }).first().click();
  await expect(page.locator("input, textarea").first()).toBeVisible();
});

test("a filled document downloads as a Word file", async ({ page }) => {
  test.skip(!has("policyTemplates"), "No templates in this product.");
  test.skip(await openTemplates(page) === 0, "This product's templates are not fillable yet.");
  const link = page.getByRole("link", { name: "Download filled" }).first();
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toMatch(/\.docx$/);
  const bytes = await (await download.createReadStream()).toArray();
  expect(Buffer.concat(bytes).subarray(0, 2).toString()).toBe("PK");
});

test("the SoA page shows controls only; scope and risk method live on the ISMS screen", async ({ page }) => {
  test.skip(!has("statementOfApplicability") || !has("ismsScreen"), "No SoA or ISMS screen in this product.");
  await open(page, "soa");
  await expect(page.getByText("Statement completeness")).toBeVisible();
  await expect(page.locator(".content textarea")).toHaveCount(0);
  await page.locator('.content a[href="#/isms"]').click();
  await expect(page.locator('.sidebar .nav a[href="#/isms"]')).toHaveClass(/active/);
  await expect(page.getByText("ISMS scope", { exact: false }).first()).toBeVisible();
});

test("scope written on the ISMS screen is kept", async ({ page }) => {
  test.skip(!has("ismsScreen"), "No ISMS screen in this product.");
  await open(page, "isms");
  const scope = page.locator("section", { hasText: "ISMS scope" }).locator("textarea");
  await scope.fill("All offices, the customer portal and its supporting cloud systems.");
  await scope.locator("xpath=ancestor::section[1]").getByRole("button", { name: /Save/ }).click();
  await page.reload();
  await expect(page.locator("section", { hasText: "ISMS scope" }).locator("textarea"))
    .toHaveValue("All offices, the customer portal and its supporting cloud systems.");
});

test("example data loads, and the dashboard counts it", async ({ page }) => {
  test.skip(!has("demoData"), "No example data in this product.");
  const csrf = (await page.context().cookies()).find((c) => c.name === "offset_csrf")!.value;
  const res = await page.request.post("/api/v1/demo", { headers: { "x-csrf-token": csrf }, data: {} });
  expect([200, 201, 409]).toContain(res.status());
  await open(page, "dashboard");
  await expect(page.locator(".content")).not.toContainText("0 in the register");
});

test("a report downloads as a PDF", async ({ page }) => {
  await open(page, "reports");
  const button = page.locator(".content button.btn.primary").first();
  await expect(button).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const bytes = Buffer.concat(await (await download.createReadStream()).toArray());
  expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
});

test("without an ISMS screen, the SoA page keeps the scope and risk method boxes", async ({ page }) => {
  test.skip(!has("statementOfApplicability") || has("ismsScreen"), "Only for an SoA page with no ISMS screen.");
  await open(page, "soa");
  await expect(page.getByText("What the management system covers")).toBeVisible();
  await expect(page.getByText("Risk assessment methodology")).toBeVisible();
});
