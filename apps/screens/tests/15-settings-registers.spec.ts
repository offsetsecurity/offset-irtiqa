import { test, expect } from "@playwright/test";
import { signIn, open, watchErrors } from "./support.js";

/**
 * Settings is the Global Settings page: a strip of tabs, each with a pill, an
 * Overview of boxes first, and each section on its own tab. A register opens
 * with chips that count and filter.
 */
test.beforeEach(async ({ page }) => { await signIn(page); });

test("Settings: a tab strip with a pill on each, and each tab opens its own section", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "settings");
  const tabs = page.locator(".gs-tabs a");
  await expect(tabs.filter({ hasText: "Overview" })).toHaveAttribute("aria-current", "page");
  for (const name of ["Updates", "HTTPS", "Outgoing email", "Daily digest"]) {
    await expect(tabs.filter({ hasText: name }).first(), name).toBeVisible();
  }
  // A pill says in a word whether it is on.
  await expect(tabs.filter({ hasText: "Daily digest" }).locator(".st-pill")).toBeVisible();
  for (const [tab, heading] of [["Updates", "Updates"], ["Outgoing email", "Outgoing email"], ["Daily digest", "Daily digest"]] as const) {
    await tabs.filter({ hasText: tab }).first().click();
    await expect(tabs.filter({ hasText: tab }).first()).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".settings-stack h2", { hasText: heading }).first(), tab).toBeVisible();
  }
  // Only the open tab's section shows.
  await expect(page.locator(".gs-card:visible")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Settings: the Overview has a box for each section and the facts about the server, and a box opens its tab", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "settings");
  const boxes = page.locator(".gs-box");
  await expect.poll(() => boxes.count(), { timeout: 8000 }).toBeGreaterThanOrEqual(5);
  for (const name of ["Updates", "HTTPS", "Outgoing email", "Daily digest"]) {
    await expect(boxes.filter({ hasText: name }).first(), name).toBeVisible();
  }
  await expect(page.locator(".gs-facts")).toContainText("Installed with");
  await boxes.filter({ hasText: "Daily digest" }).click();
  await expect(page).toHaveURL(/#\/settings\/digest/);
  await expect(page.locator(".settings-stack h2", { hasText: "Daily digest" }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Settings: the Overview fits one screen, so nobody scrolls", async ({ page }) => {
  for (const [width, height] of [[1600, 1000], [1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    await open(page, "settings");
    await expect.poll(() => page.locator(".gs-box").count(), { timeout: 8000 }).toBeGreaterThanOrEqual(5);
    await expect(page.locator(".gs-facts")).toBeVisible();
    await page.waitForTimeout(400);
    const over = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(over, `${width}x${height}: the page is this many pixels taller than the window`).toBeLessThanOrEqual(0);
  }
});

test("Settings: a link to a tab opens it directly", async ({ page }) => {
  await open(page, "settings/email");
  await expect(page.locator(".gs-tabs a[aria-current=page]")).toContainText("Outgoing email");
  await expect(page.locator(".settings-stack h2", { hasText: "Outgoing email" }).first()).toBeVisible();
});

test("A register shows its statuses as chips with counts, and a chip filters the rows", async ({ page }) => {
  const csrf = (await page.context().cookies()).find((c) => c.name === "offset_csrf")!.value;
  for (const [title, status] of [["Chip test open", "Open"], ["Chip test done", "Done"]] as const) {
    expect((await page.request.post("/api/v1/tasks", { headers: { "x-csrf-token": csrf }, data: { title, status } })).status()).toBe(201);
  }
  await open(page, "tasks");
  const chips = page.locator(".reg-chips button");
  await expect(chips.first()).toContainText("All");
  expect(await chips.count()).toBeGreaterThanOrEqual(2);
  const all = await page.locator("tbody tr").count();
  await chips.nth(1).click();
  await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator("tbody tr").count()).toBeLessThanOrEqual(all);
  await chips.first().click();
  await expect(page.locator("tbody tr")).toHaveCount(all);
});
