import { test, expect, type Page } from "@playwright/test";
import { signIn, open } from "./support.js";

/**
 * The risk picker in a control's window lists every risk with a tick box and
 * can add a new one; every item window can be made full size or dragged
 * larger; and a risk cannot be in the register twice.
 */
test.beforeEach(async ({ page }) => { await signIn(page); });

async function headers(page: Page): Promise<Record<string, string>> {
  return { "x-csrf-token": (await page.context().cookies()).find((c) => c.name === "offset_csrf")!.value };
}

async function openControl(page: Page, fromEnd: number): Promise<{ id: string; ref: string }> {
  const list = await (await page.request.get("/api/v1/controls")).json() as { controls: { id: string; ref: string }[] };
  const c = list.controls[list.controls.length - fromEnd]!;
  await page.goto(`/#/controls/${c.id}?fix=risks`);
  await expect(page.locator(".modal")).toContainText(c.ref);
  // The checks, and the strip with them, arrive a moment after the window opens.
  await expect(page.locator(".fix-panel")).toBeVisible();
  return c;
}

test("the risk picker lists every risk with a tick box, not just the first eight", async ({ page }) => {
  const h = await headers(page);
  const stamp = Date.now();
  for (let i = 1; i <= 12; i++) {
    expect((await page.request.post("/api/v1/risks", { headers: h, data: { title: `Picker list ${stamp} risk ${i}`, likelihood: 2, impact: 2 } })).status()).toBe(201);
  }
  await openControl(page, 8);
  test.skip(await page.locator(".thread-strip").count() === 0, "No risk picker in the control window in this product.");
  const picker = page.locator(".ts-link");
  await expect(picker.locator(".lp-opt").filter({ hasText: `Picker list ${stamp}` })).toHaveCount(12);
  await picker.locator(".lp-opt", { hasText: `Picker list ${stamp} risk 12` }).locator("input[type=checkbox]").check();
  await expect(picker.locator(".lp-chips")).toContainText(`Picker list ${stamp} risk 12`);
  await picker.locator(".lp-opt", { hasText: `Picker list ${stamp} risk 12` }).locator("input[type=checkbox]").uncheck();
  await expect(picker.locator(".lp-chips")).toHaveCount(0);
});

test("a risk that is not in the register can be typed and added from the control window", async ({ page }) => {
  const c = await openControl(page, 9);
  test.skip(await page.locator(".thread-strip").count() === 0, "No risk picker in the control window in this product.");
  const title = `Typed new risk ${Date.now()}`;
  const picker = page.locator(".ts-link");
  await picker.locator(".lp-search").fill(title);
  await picker.getByRole("button", { name: `+ Add "${title}" as a new risk` }).click();
  await expect(picker.locator(".lp-chips")).toContainText(title);
  await picker.getByRole("button", { name: "Save links" }).click();
  await expect(page.locator(".thread-strip .ts-chip.ok").filter({ hasText: title })).toBeVisible();
  const { risks } = await (await page.request.get("/api/v1/risks")).json() as { risks: { title: string; control_ids: string[] }[] };
  expect(risks.find((r) => r.title === title)!.control_ids).toEqual([c.id]);
});

test("no 'add as new' is offered for a risk that already exists", async ({ page }) => {
  const title = `Existing risk ${Date.now()}`;
  expect((await page.request.post("/api/v1/risks", { headers: await headers(page), data: { title, likelihood: 2, impact: 2 } })).status()).toBe(201);
  await openControl(page, 10);
  test.skip(await page.locator(".thread-strip").count() === 0, "No risk picker in the control window in this product.");
  await page.locator(".ts-link .lp-search").fill(title.toUpperCase());
  await expect(page.locator(".ts-link .lp-opt")).toHaveCount(1);
  await expect(page.locator(".ts-link .lp-create")).toHaveCount(0);
});

test("a window can be made full size, is remembered, and can be made smaller again", async ({ page }) => {
  await openControl(page, 11);
  const modal = page.locator(".modal");
  const small = (await modal.boundingBox())!.width;
  await modal.getByRole("button", { name: "Make this window full size" }).click();
  await expect(modal).toHaveClass(/expanded/);
  expect((await modal.boundingBox())!.width).toBeGreaterThan(small + 200);
  await modal.locator("footer").getByRole("button", { name: "Cancel" }).click();
  await open(page, "risks");
  await page.locator(".content button.btn.primary", { hasText: /^Add risk$/ }).click();
  await expect(page.locator(".modal")).toHaveClass(/expanded/);
  await page.locator(".modal").getByRole("button", { name: "Make this window smaller" }).click();
  await expect(page.locator(".modal")).not.toHaveClass(/expanded/);
});

test("a window can be dragged larger by its corner", async ({ page }) => {
  await openControl(page, 12);
  const modal = page.locator(".modal");
  expect(await modal.evaluate((el) => getComputedStyle(el).resize)).toBe("both");
});

test("a risk cannot be added twice, whatever the case or spacing", async ({ page }) => {
  const h = await headers(page);
  const title = `Duplicate check ${Date.now()}`;
  expect((await page.request.post("/api/v1/risks", { headers: h, data: { title, likelihood: 2, impact: 2 } })).status()).toBe(201);
  const again = await page.request.post("/api/v1/risks", { headers: h, data: { title: `  ${title.toUpperCase()} `, likelihood: 3, impact: 3 } });
  expect(again.status()).toBe(409);
  expect((await again.json()).error).toMatch(/already a risk called this: #\d+/);
  // The form says so, too.
  await open(page, "risks");
  await page.locator(".content button.btn.primary", { hasText: /^Add risk$/ }).click();
  await page.locator(".modal input[required]").first().fill(title);
  await page.locator(".modal").getByRole("button", { name: "Add risk" }).click();
  await expect(page.locator(".modal")).toContainText("already a risk called this");
});

test("renaming a risk to another risk's title is refused", async ({ page }) => {
  const h = await headers(page);
  const stamp = Date.now();
  await page.request.post("/api/v1/risks", { headers: h, data: { title: `Rename A ${stamp}`, likelihood: 2, impact: 2 } });
  const b = (await (await page.request.post("/api/v1/risks", { headers: h, data: { title: `Rename B ${stamp}`, likelihood: 2, impact: 2 } })).json()).risk as { id: string };
  expect((await page.request.patch(`/api/v1/risks/${b.id}`, { headers: h, data: { title: `Rename A ${stamp}` } })).status()).toBe(409);
  expect((await page.request.patch(`/api/v1/risks/${b.id}`, { headers: h, data: { title: `Rename B ${stamp}` } })).status()).toBe(200);
});
