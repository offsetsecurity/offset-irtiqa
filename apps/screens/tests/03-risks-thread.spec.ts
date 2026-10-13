import { test, expect } from "@playwright/test";
import { signIn, open, has } from "./support.js";

test.beforeEach(async ({ page }) => { await signIn(page); });

test("Risks has three tabs: Register, Sample library and Golden thread", async ({ page }) => {
  await open(page, "risks");
  const tabs = page.locator(".sub-tabs").first().getByRole("button");
  await expect(tabs).toHaveText(["Register", "Sample library", "Golden thread"]);
  await expect(page.locator('.sidebar .nav a[href="#/thread"]')).toHaveCount(0);
});

test("the Golden thread tab opens the thread, by click and by address", async ({ page }) => {
  await open(page, "risks");
  await page.locator(".sub-tabs").first().getByRole("button", { name: "Golden thread" }).click();
  await expect(page.locator(".sub-tabs button.sel")).toHaveText("Golden thread");
  await page.goto("/#/risks/thread");
  await page.reload();
  await expect(page.locator(".sub-tabs button.sel")).toHaveText("Golden thread");
});

test("an old link to the Golden thread still lands on it", async ({ page }) => {
  await page.goto("/#/thread");
  await page.reload();
  await expect(page.locator('.sidebar .nav a[href="#/risks"]')).toHaveClass(/active/);
  await expect(page.locator(".sub-tabs button.sel")).toHaveText("Golden thread");
});

test("a risk added from the Sample library arrives linked to its controls", async ({ page }) => {
  await open(page, "risks");
  await page.locator(".sub-tabs").first().getByRole("button", { name: "Sample library" }).click();
  // The first sample that names its controls and is not in the register yet.
  const row = page.locator(".sl-refs")
    .locator("xpath=ancestor::div[.//button[normalize-space()='Add']][1]").first();
  const button = row.getByRole("button", { name: "Add", exact: true });
  await expect(button).toBeVisible();
  const refs = (await row.locator(".sl-refs").innerText()).replace(/^covers\s+/, "").split(/,\s*/);
  await button.click();
  await expect(row.getByText("In your register")).toBeVisible();

  const thread = await (await page.request.get("/api/v1/thread")).json() as {
    risks: { title: string; controls: string[] }[]; controls: { id: string; ref: string }[];
  };
  const linked = thread.risks.flatMap((r) => r.controls).map((id) => thread.controls.find((c) => c.id === id)?.ref);
  for (const ref of refs) expect(linked, `control ${ref} is linked`).toContain(ref);
});

test("from the Golden thread tab, a link back to the risk register works", async ({ page }) => {
  await open(page, "risks");
  await page.locator(".sub-tabs").first().getByRole("button", { name: "Golden thread" }).click();
  await expect(page).toHaveURL(/#\/risks\/thread$/);
  // The menu's Risks link, like "Open the risk register", goes to "#/risks".
  await page.locator('.sidebar .nav a[href="#/risks"]').click();
  await expect(page.locator(".sub-tabs button.sel")).toHaveText("Register");
  await expect(page).toHaveURL(/#\/risks$/);
});

test("a risk whose controls are not started is not called whole, and says what to do next", async ({ page }) => {
  const csrf = (await page.context().cookies()).find((c) => c.name === "offset_csrf")!.value;
  const { controls } = await (await page.request.get("/api/v1/controls")).json() as { controls: { id: string; ref: string; status: string }[] };
  const control = controls.find((c) => c.status === "not_started")!;
  const res = await page.request.post("/api/v1/risks", { headers: { "x-csrf-token": csrf }, data: {
    title: "Thread check: control not started", likelihood: 4, impact: 5, treatment: "Mitigate", owner: "Head of IT", controlIds: [control.id] } });
  const { risk } = await res.json() as { risk: { id: string } };

  await page.goto("/#/risks/thread");
  await page.reload();
  await page.locator(`.gt-n[data-type="r"][data-id="${risk.id}"]`).first().click();
  const panel = page.locator(".gt");
  await expect(panel.locator(".gt-k", { hasText: has("isoClauses") ? "Clauses" : "Checks" })).toBeVisible();
  await expect(panel).toContainText("Treatment carried out");
  await expect(panel).toContainText("None of its 1 control is in place yet.");
  await expect(panel).not.toContainText("Whole thread");
  const next = panel.getByRole("link", { name: `Open ${control.ref}` });
  await expect(next).toHaveAttribute("href", new RegExp(`#/controls/${control.id}[?]fix=status`));
});
