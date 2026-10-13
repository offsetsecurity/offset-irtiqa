import { test, expect, type Page, type Locator } from "@playwright/test";
import { signIn, open } from "./support.js";

/**
 * Add, edit and delete on every register screen this product has: assets,
 * policies, tasks, incidents, findings, suppliers, training, objectives,
 * interested parties, reviews and communications. They share one form, so one
 * test walks them all, and each one runs on whatever the product shows.
 */
test.beforeEach(async ({ page }) => { await signIn(page); });

const REGISTERS = ["assets", "policies", "tasks", "incidents", "findings", "vendors", "training",
  "objectives", "parties", "reviews", "communications"];
const today = new Date().toISOString().slice(0, 10);

/** Fills every required box in the open form that is still empty. */
async function fillRequired(modal: Locator, name: string): Promise<void> {
  for (const input of await modal.locator("input[required], textarea[required]").all()) {
    if (await input.inputValue()) continue;
    const type = await input.getAttribute("type");
    await input.fill(type === "date" ? today : type === "number" ? "1" : type === "email" ? "someone@example.test" : name);
  }
  for (const select of await modal.locator("select[required]").all()) {
    if (await select.inputValue()) continue;
    const values = await select.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    if (values[0]) await select.selectOption(values[0]);
  }
}

async function registersHere(page: Page): Promise<string[]> {
  await open(page, "dashboard");
  const hrefs = await page.locator(".sidebar .nav a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  return REGISTERS.filter((r) => hrefs.includes(`#/${r}`));
}

test("every register screen adds, edits and deletes a row", async ({ page }) => {
  test.setTimeout(240_000);
  const here = await registersHere(page);
  expect(here.length, "this product has register screens").toBeGreaterThan(0);
  for (const route of here) {
    const name = `Screen test ${route} ${Date.now()}`;
    await open(page, route);
    const add = page.locator(".content button.btn.primary", { hasText: /^Add / }).first();
    await expect(add, `${route}: Add button`).toBeVisible();
    await add.click();
    const modal = page.locator(".modal");
    await expect(modal, `${route}: form opens`).toBeVisible();
    await fillRequired(modal, name);
    await modal.locator(".modal-foot button.btn.primary, button.btn.primary").last().click();
    await expect(modal, `${route}: form closes after adding`).toHaveCount(0);
    const row = page.locator(".content tr", { hasText: name });
    await expect(row, `${route}: new row listed`).toBeVisible();

    await row.locator("td").nth(1).click();
    await expect(modal, `${route}: row opens`).toBeVisible();
    const first = modal.locator("input[required]").first();
    await first.fill(`${name} edited`);
    await modal.getByRole("button", { name: "Save changes" }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.locator(".content tr", { hasText: `${name} edited` }), `${route}: edit saved`).toBeVisible();

    await page.locator(".content tr", { hasText: `${name} edited` }).locator("td").nth(1).click();
    await modal.getByRole("button", { name: "Delete" }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.locator(".content tr", { hasText: name }), `${route}: row deleted`).toHaveCount(0);
  }
});

test("an administrator adds a person, and they are listed", async ({ page }) => {
  await open(page, "people");
  await page.locator(".content button.btn.primary").first().click();
  const modal = page.locator(".modal");
  await expect(modal).toBeVisible();
  const stamp = Date.now();
  // Full name, Username and Email are the first three boxes.
  const boxes = modal.locator("input");
  await boxes.nth(0).fill(`Screen Person ${stamp}`);
  await boxes.nth(1).fill(`screen${stamp}`);
  await boxes.nth(2).fill(`screen${stamp}@example.test`);
  await fillRequired(modal, `screen${stamp}`);
  await modal.getByRole("button", { name: "Add person" }).click();
  // A password to pass on may be shown once; close it.
  const done = page.getByRole("button", { name: "Done" });
  if (await done.isVisible().catch(() => false)) await done.click();
  await expect(page.locator(".content")).toContainText(`screen${stamp}`);
});

test("a backup can be taken, and it is listed", async ({ page }) => {
  await open(page, "backups");
  await page.waitForLoadState("networkidle");
  const before = await page.locator(".content tbody tr").count();
  await page.getByRole("button", { name: "Take a backup now" }).click();
  await expect.poll(() => page.locator(".content tbody tr").count(), { timeout: 30_000 }).toBeGreaterThan(before);
});
