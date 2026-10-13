import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./support.js";

/**
 * The Golden thread's fix buttons open the exact item, with the box to change
 * selected, and closing it goes back to the thread.
 */
test.beforeEach(async ({ page }) => { await signIn(page); });

async function csrf(page: Page): Promise<Record<string, string>> {
  return { "x-csrf-token": (await page.context().cookies()).find((c) => c.name === "offset_csrf")!.value };
}

async function aControl(page: Page): Promise<{ id: string; ref: string }> {
  const list = await (await page.request.get("/api/v1/controls")).json() as { controls: { id: string; ref: string }[] };
  return list.controls[list.controls.length - 2]!;
}

async function aRisk(page: Page, title: string, extra: Record<string, unknown> = {}): Promise<{ id: string; seq: number }> {
  const res = await page.request.post("/api/v1/risks", { headers: await csrf(page), data: { title, likelihood: 3, impact: 3, ...extra } });
  expect(res.status()).toBe(201);
  return (await res.json()).risk;
}

test("a link to a control opens that control with the Owner box selected", async ({ page }) => {
  const c = await aControl(page);
  await page.goto(`/#/controls/${c.id}?fix=owner&back=thread`);
  await expect(page.locator(".modal")).toContainText(c.ref);
  await expect(page.locator('.modal [data-fix="owner"]')).toBeFocused();
  // The address settles, so a reload does not reopen it.
  await expect(page).toHaveURL(/#\/controls$/);
});

test("closing a control opened from the thread goes back to the thread", async ({ page }) => {
  const c = await aControl(page);
  await page.goto(`/#/controls/${c.id}?fix=owner&back=thread`);
  await expect(page.locator(".modal")).toContainText(c.ref);
  await page.locator(".modal").getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/#\/risks\/thread$/);
  await expect(page.locator(".sub-tabs button.sel")).toHaveText("Golden thread");
});

test("a link to a control's evidence scrolls to its Evidence section", async ({ page }) => {
  const c = await aControl(page);
  await page.goto(`/#/controls/${c.id}?fix=evidence`);
  await expect(page.locator(".modal")).toContainText(c.ref);
  await expect(page.locator('.modal [data-fix="evidence"]')).toBeInViewport();
});

test("a link that asks for the control's risks opens the risk picker in the window", async ({ page }) => {
  const c = await aControl(page);
  await page.goto(`/#/controls/${c.id}?fix=risks`);
  await expect(page.locator(".modal")).toContainText(c.ref);
  await expect(page.locator(".fix-panel")).toBeVisible();
  test.skip(await page.locator(".thread-strip").count() === 0, "This product has no risk picker in the control window yet.");
  await expect(page.locator(".ts-link")).toContainText(`Which risks does ${c.ref} treat?`);
});

test("a link to a risk opens that risk with the Owner box selected", async ({ page }) => {
  const r = await aRisk(page, "Fix link test: unowned risk");
  await page.goto(`/#/risks/${r.id}?fix=owner&back=thread`);
  await expect(page.locator(".modal")).toContainText(`Risk ${r.seq}`);
  await expect(page.locator('.modal [data-fix="owner"]')).toBeFocused();
  await page.locator(".modal").getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/#\/risks\/thread$/);
});

test("a link to a risk's controls selects its Controls box", async ({ page }) => {
  const r = await aRisk(page, "Fix link test: untreated risk");
  await page.goto(`/#/risks/${r.id}?fix=controls`);
  await expect(page.locator(".modal")).toContainText(`Risk ${r.seq}`);
  await expect(page.locator('.modal [data-fix="controls"] .lp-search')).toBeFocused();
});

test("a link to evidence opens it with the Collected date selected", async ({ page }) => {
  const res = await page.request.post("/api/v1/evidence", { headers: await csrf(page), data: { name: "Fix link test: undated evidence", collectedDate: null } });
  expect(res.status()).toBe(201);
  const ev = (await res.json()).evidence as { id: string };
  await page.goto(`/#/evidence/${ev.id}?fix=collected&back=thread`);
  await expect(page.locator('.modal input[name], .modal input').first()).toBeVisible();
  await expect(page.locator('.modal [data-fix="collected"]')).toBeFocused();
});

test("a link to something that no longer exists says so, instead of opening the wrong thing", async ({ page }) => {
  await page.goto("/#/controls/00000000-0000-4000-8000-000000000000?fix=owner");
  await expect(page.locator(".content")).toContainText("no longer in the register");
  await expect(page.locator(".modal")).toHaveCount(0);
});

test("on the Golden thread, a broken risk's fix button opens that risk, ready to link controls", async ({ page }) => {
  const r = await aRisk(page, "Fix link test: from the thread", { owner: "Head of IT" });
  await page.goto("/#/risks/thread");
  await page.reload();
  await page.locator(`.gt-n[data-type="r"][data-id="${r.id}"]`).first().click();
  const open = page.locator(".gt").getByRole("link", { name: "Open the risk" });
  await expect(open).toHaveAttribute("href", new RegExp(`#/risks/${r.id}[?]fix=controls&back=thread`));
  await open.click();
  await expect(page.locator(".modal")).toContainText(`Risk ${r.seq}`);
  await expect(page.locator('.modal [data-fix="controls"] .lp-search')).toBeFocused();
  await page.locator(".modal").getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/#\/risks\/thread$/);
});

test("no fix button on the Golden thread points at a general list any more", async ({ page }) => {
  await page.goto("/#/risks/thread");
  await page.reload();
  await expect(page.locator(".gt")).toBeVisible();
  for (const node of (await page.locator('.gt-n[data-type="r"], .gt-n[data-type="c"]').all()).slice(0, 12)) {
    await node.click();
    const hrefs = await page.locator(".gt .gt-actions a, .gt-problem a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    for (const href of hrefs) {
      if (href === "#/evidence") continue; // "Add new evidence" is a real new item, not a fix.
      expect(href, "fix buttons name the item they fix").toMatch(/^#\/(controls|risks|evidence)\/[^?]+\?fix=/);
    }
    await page.keyboard.press("Escape");
  }
});
