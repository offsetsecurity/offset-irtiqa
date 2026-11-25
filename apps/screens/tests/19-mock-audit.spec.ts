import { test, expect } from "@playwright/test";
import { signIn, open, watchErrors } from "./support.js";

/**
 * "Run a mock audit" sits in a banner at the top of "If the auditor came
 * today", as a raised button, and shows that it ran: "Checking your records…"
 * long enough to see, then "Checked just now".
 */
test.beforeEach(async ({ page }) => { await signIn(page); });

test("Plan: Run a mock audit is in view when the page opens, without scrolling", async ({ page }) => {
  for (const [width, height] of [[1600, 1000], [1440, 900], [1366, 768]] as const) {
    await page.setViewportSize({ width, height });
    await open(page, "getready");
    const button = page.locator(".ma-banner").getByRole("button", { name: /Run a mock audit/ });
    await expect(button).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const box = (await button.boundingBox())!;
    const inner = await page.evaluate(() => window.innerHeight);
    expect(box.y + box.height, `${width}x${height}: the button's bottom must be inside the window (${inner}px)`).toBeLessThanOrEqual(inner);
  }
});

test("Plan: the mock audit banner is at the top of the card, and running it shows it ran", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "getready");
  const banner = page.locator(".ma-banner");
  await expect(banner).toBeVisible({ timeout: 10000 });
  // The banner comes before the findings, not under them.
  const card = page.locator(".card", { has: banner });
  const bannerBox = (await banner.boundingBox())!;
  const labelBox = (await card.locator(".sr-lbl").first().boundingBox())!;
  expect(bannerBox.y).toBeLessThan(labelBox.y);
  // There is only one way to run it.
  await expect(page.getByRole("button", { name: /Run a mock audit/ })).toHaveCount(1);

  const button = banner.getByRole("button", { name: /Run a mock audit/ });
  await button.click();
  await expect(banner.getByRole("button", { name: /Checking your records/ })).toBeVisible();
  await expect(banner.getByRole("status")).toContainText("Checked just now", { timeout: 8000 });
  await expect(button).toBeEnabled();
  expect(errors).toEqual([]);
});
