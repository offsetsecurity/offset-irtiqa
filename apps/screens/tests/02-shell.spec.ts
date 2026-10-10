import { test, expect } from "@playwright/test";
import { pack, signIn, open, watchErrors } from "./support.js";

test.beforeEach(async ({ page }) => { await signIn(page); });

test("the sidebar leads with this product, and credits Offset Security at the foot", async ({ page }) => {
  await open(page, "dashboard");
  const head = page.locator(".sidebar .brand.side");
  await expect(head).toContainText(pack.product);
  await expect(head).toContainText(pack.framework);
  await expect(head.locator("svg.pmark")).toBeVisible();
  const foot = page.locator(".sidebar-foot");
  await expect(foot).toContainText("Developed by Offset Security");
  if (pack.contact) await expect(foot).toContainText(`Contact: ${pack.contact}`);
  // The version lives on the Help page, so the foot stays short.
  await expect(foot).not.toContainText(/Version/);
});

test("Help says which product and version this is", async ({ page }) => {
  await open(page, "help");
  await expect(page.locator(".help-version")).toHaveText(new RegExp(`^${pack.product}, version [0-9]+[.][0-9]+[.][0-9]+$`));
});

test("hiding the menu labels leaves the product's icon", async ({ page }) => {
  await open(page, "dashboard");
  await page.locator(".collapse-btn").click();
  await expect(page.locator(".sidebar-head svg.mark")).toBeVisible();
  await expect(page.locator(".sidebar .brand.side")).toHaveCount(0);
  await page.locator(".collapse-btn").click();
  await expect(page.locator(".sidebar .brand.side")).toBeVisible();
});

test("every screen in the menu opens without an error", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, "dashboard");
  // Closed menu sections still carry their links, so every screen is listed.
  const hrefs = await page.locator(".sidebar .nav a").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  expect(hrefs.length).toBeGreaterThan(8);
  for (const href of hrefs) {
    await page.goto(`/${href}`);
    await expect(page.locator(".topbar h1"), href).not.toBeEmpty();
    // Every screen settles: no "Loading…" left and no failed card.
    await expect(page.locator(".content .card.err"), href).toHaveCount(0);
    await expect(page.getByText("Loading…", { exact: true }), href).toHaveCount(0, { timeout: 15_000 });
  }
  expect(errors, "no script errors on any screen").toEqual([]);
});

test("the address of a screen opens that screen, and its menu item is marked", async ({ page }) => {
  await open(page, "risks");
  await expect(page.locator('.sidebar .nav a[href="#/risks"]')).toHaveClass(/active/);
});
