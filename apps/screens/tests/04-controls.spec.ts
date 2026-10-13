import { test, expect, type Page } from "@playwright/test";
import { signIn, open } from "./support.js";

test.beforeEach(async ({ page }) => { await signIn(page); });

/** Opens the first control in the register and returns its reference. */
async function openFirstControl(page: Page): Promise<string> {
  await open(page, "controls");
  const row = page.locator(".content table tbody tr").first();
  const ref = (await row.locator("td").first().innerText()).trim();
  await row.locator("td").nth(1).click();
  await expect(page.locator(".fix-panel")).toBeVisible();
  return ref;
}

test("a control's window opens with what to fix, and each fix has a button", async ({ page }) => {
  await openFirstControl(page);
  const head = page.locator(".fix-head b");
  await expect(head).toHaveText(/How to fix this: \d+ things? to do|Nothing to fix/);
  await expect(page.locator(".fix-panel li.bad, .fix-panel li.weak").first()).toBeVisible();
  await expect(page.locator(".fix-panel li").filter({ hasText: "Nobody owns it" })).toBeVisible();
});

test("Name an owner jumps to the Owner box", async ({ page }) => {
  await openFirstControl(page);
  await page.getByRole("button", { name: "Name an owner" }).click();
  await expect(page.locator('[data-fix="owner"]')).toBeFocused();
});

test("typing an owner fixes that line at once, before saving", async ({ page }) => {
  await openFirstControl(page);
  await page.locator('[data-fix="owner"]').fill("IT Manager");
  await expect(page.locator(".fix-panel li.ok").filter({ hasText: "Owned by IT Manager" })).toBeVisible();
});

test("Check again rechecks, and says so", async ({ page }) => {
  await openFirstControl(page);
  test.skip(await page.locator(".fix-check").count() === 0, "This product does not say when it rechecked yet.");
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.locator(".fix-check")).toContainText("Checked just now");
});

test("the Golden thread strip shows the risks, the control and its evidence", async ({ page }) => {
  const ref = await openFirstControl(page);
  const strip = page.locator(".thread-strip");
  test.skip(await strip.count() === 0, "This product does not show the strip yet.");
  await expect(strip.locator(".ts-ctl")).toContainText(ref);
  await expect(strip.locator(".ts-state")).toHaveText(/Thread (whole|broken)|Excluded/);
  await expect(strip.getByText("Nothing attached")).toBeVisible();
});

test("evidence attached in the window turns the strip green without a click", async ({ page }) => {
  const ref = await openFirstControl(page);
  const strip = page.locator(".thread-strip");
  test.skip(await strip.count() === 0, "This product does not show the strip yet.");
  // Behind the scenes, the way a colleague might: a risk and fresh evidence for this control.
  const csrf = (await page.context().cookies()).find((c) => c.name === "offset_csrf")!.value;
  const list = await (await page.request.get("/api/v1/controls")).json() as { controls?: { id: string; ref: string }[] };
  const id = (list.controls ?? (list as unknown as { id: string; ref: string }[])).find((c) => c.ref === ref)!.id;
  const headers = { "x-csrf-token": csrf };
  expect((await page.request.post("/api/v1/risks", { headers, data: { title: `Strip test risk for ${ref}`, likelihood: 2, impact: 3, controlIds: [id] } })).status()).toBe(201);
  expect((await page.request.post("/api/v1/evidence", { headers, data: { name: "Strip test evidence", collectedDate: new Date().toISOString().slice(0, 10), controlIds: [id] } })).status()).toBe(201);
  await page.locator('[data-fix="owner"]').fill("IT Manager");
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(strip.locator(".ts-state")).toHaveText("Thread whole");
  await expect(strip.locator(".ts-chip.ok").filter({ hasText: "Strip test evidence" })).toBeVisible();
});

test("No risk linked opens a picker right in the window, and saving links the risk", async ({ page }) => {
  // The last control in the register, so earlier tests have not linked it.
  await open(page, "controls");
  const row = page.locator(".content table tbody tr").last();
  const ref = (await row.locator("td").first().innerText()).trim();
  const csrf = (await page.context().cookies()).find((c) => c.name === "offset_csrf")!.value;
  const title = `Picker test risk for ${ref}`;
  expect((await page.request.post("/api/v1/risks", { headers: { "x-csrf-token": csrf }, data: { title, likelihood: 3, impact: 3 } })).status()).toBe(201);

  await row.locator("td").nth(1).click();
  const strip = page.locator(".thread-strip");
  test.skip(await strip.count() === 0, "This product does not show the strip yet.");
  await strip.getByRole("button", { name: /No risk linked/ }).click();
  const picker = page.locator(".ts-link");
  await expect(picker).toContainText(`Which risks does ${ref} treat?`);
  await picker.locator(".lp-search").fill("Picker test risk");
  await picker.getByText(title).click();
  await picker.getByRole("button", { name: "Save links" }).click();
  await expect(picker).toHaveCount(0);
  await expect(strip.locator(".ts-chip.ok").filter({ hasText: title })).toBeVisible();

  // The risk register shows the same link from the other side.
  const { risks } = await (await page.request.get("/api/v1/risks")).json() as { risks: { title: string; control_ids: string[] }[] };
  expect(risks.find((r) => r.title === title)!.control_ids).toHaveLength(1);
});
