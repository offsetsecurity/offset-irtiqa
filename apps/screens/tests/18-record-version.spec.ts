import { test, expect, type Page } from "@playwright/test";
import { signIn, open } from "./support.js";

/**
 * GL-5: a save over somebody else's change is refused in plain words; a
 * person's own quick second save is not (developer review, 15 Nov 2026: the
 * owner box saves when it loses focus, and the maturity menu a moment later).
 */
test.beforeEach(async ({ page }) => { await signIn(page); });

const csrfOf = async (page: Page) => (await page.context().cookies()).find((c) => c.name === "offset_csrf")?.value ?? "";
const patches = (page: Page) => {
  const seen: number[] = [];
  page.on("response", (r) => { if (r.request().method() === "PATCH" && r.url().includes("/api/v1/controls/")) seen.push(r.status()); });
  return seen;
};

test("GL-5: two quick saves of my own on one control are both kept, even on a slow network", async ({ page }) => {
  // Every change takes most of a second to answer, so the second is sent before the first returns.
  await page.route("**/api/v1/controls/*", async (route) => {
    if (route.request().method() === "PATCH") await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  const statuses = patches(page);
  await open(page, "controls");
  const row = page.locator(".content table tbody tr").nth(2);
  await row.locator(".owner-input").fill("Quick Saver");
  // Leaving the box saves the owner; the status is chosen at once after.
  await row.locator(".owner-input").press("Tab");
  // Irtiqa scores each control's maturity in the row (Assure has a status menu there).
  await row.locator(".maturity-select").first().selectOption("2");
  await expect.poll(() => statuses.length, { timeout: 10_000 }).toBe(2);
  expect(statuses).toEqual([200, 200]);
  await expect(page.getByText("Someone else changed this")).toHaveCount(0);
});

test("GL-5: a save over somebody else's change is refused, and works again after a reload", async ({ page }) => {
  const statuses = patches(page);
  await open(page, "controls");
  const row = page.locator(".content table tbody tr").nth(3);
  const ref = (await row.locator("td").first().innerText()).trim();
  // Somebody else changes this control after the page read it.
  const all = (await (await page.request.get("/api/v1/controls")).json()) as { controls: { id: string; ref: string }[] };
  const id = all.controls.find((c) => c.ref === ref)!.id;
  await page.waitForTimeout(20);
  expect((await page.request.patch(`/api/v1/controls/${id}`, { headers: { "x-csrf-token": await csrfOf(page) }, data: { notes: "Changed by somebody else" } })).status()).toBe(200);
  // Now this page saves from what it read before.
  await row.locator(".owner-input").fill("Late Saver");
  await row.locator(".owner-input").press("Enter");
  await expect(page.getByText(/Someone else changed this while you were editing it\. Reload the page/)).toBeVisible();
  expect(statuses).toContain(409);
  // After a reload the page has the new version, and the same change goes through.
  await page.reload();
  await expect(page.locator(".topbar h1")).toBeVisible();
  const again = page.locator(".content table tbody tr").nth(3);
  await again.locator(".owner-input").fill("Late Saver");
  await again.locator(".owner-input").press("Enter");
  await expect.poll(() => statuses[statuses.length - 1]).toBe(200);
});
