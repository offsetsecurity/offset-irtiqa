import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./support.js";

/**
 * Linking evidence from the Golden thread: the picker offers the right pieces,
 * says when there are more than it shows, saves the link, and "Add new
 * evidence" goes to the control itself.
 */
test.beforeEach(async ({ page }) => { await signIn(page); });

const daysAgo = (n: number): string => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

async function headers(page: Page): Promise<Record<string, string>> {
  return { "x-csrf-token": (await page.context().cookies()).find((c) => c.name === "offset_csrf")!.value };
}

/** A control marked implemented with an owner and a risk, so the thread shows it, from the end of the register. */
async function implementedControl(page: Page, fromEnd: number): Promise<{ id: string; ref: string }> {
  const list = await (await page.request.get("/api/v1/controls")).json() as { controls: { id: string; ref: string }[] };
  const c = list.controls[list.controls.length - fromEnd]!;
  const h = await headers(page);
  expect((await page.request.patch(`/api/v1/controls/${c.id}`, { headers: h, data: { status: "implemented", owner: "IT Manager" } })).status()).toBe(200);
  expect((await page.request.post("/api/v1/risks", { headers: h, data: { title: `Evidence test risk for ${c.ref}`, likelihood: 2, impact: 3, owner: "IT Manager", controlIds: [c.id] } })).status()).toBe(201);
  return c;
}

async function evidence(page: Page, name: string, collectedDate: string | null, controlIds: string[] = []): Promise<string> {
  const res = await page.request.post("/api/v1/evidence", { headers: await headers(page), data: { name, collectedDate, controlIds } });
  expect(res.status()).toBe(201);
  return (await res.json()).evidence.id as string;
}

async function openOnThread(page: Page, controlId: string): Promise<void> {
  await page.goto("/#/risks/thread");
  await page.reload();
  await page.locator(`.gt-n[data-type="c"][data-id="${controlId}"]`).first().click();
}

test("Link existing evidence links the chosen piece, and the control is no longer broken", async ({ page }) => {
  const c = await implementedControl(page, 3);
  await evidence(page, "Evidence test: access review sign-off", daysAgo(5));
  await openOnThread(page, c.id);
  await page.getByRole("button", { name: "Link existing evidence" }).click();
  const picker = page.locator(".gt-linker");
  await picker.locator(".lp-search").fill("access review sign-off");
  await picker.getByText("Evidence test: access review sign-off").click();
  await picker.getByRole("button", { name: "Save the link" }).click();
  await expect(picker).toHaveCount(0);
  const thread = await (await page.request.get(`/api/v1/thread/control/${c.id}`)).json() as { evidence: { name: string }[] };
  expect(thread.evidence.map((e) => e.name)).toContain("Evidence test: access review sign-off");
});

test("evidence already linked to the control is not offered again", async ({ page }) => {
  const c = await implementedControl(page, 4);
  await evidence(page, "Evidence test: already linked, but old", daysAgo(200), [c.id]);
  await evidence(page, "Evidence test: not linked yet", daysAgo(3));
  await openOnThread(page, c.id);
  await page.getByRole("button", { name: "Link newer evidence" }).click();
  const picker = page.locator(".gt-linker");
  await picker.locator(".lp-search").fill("Evidence test:");
  await expect(picker.getByText("Evidence test: not linked yet")).toBeVisible();
  await expect(picker.locator(".lp-opt").filter({ hasText: "already linked, but old" })).toHaveCount(0);
});

test("old evidence gets a quick Link newer evidence button", async ({ page }) => {
  const c = await implementedControl(page, 5);
  await evidence(page, "Evidence test: last year's report", daysAgo(400), [c.id]);
  await openOnThread(page, c.id);
  await expect(page.locator(".gt-problem.warn")).toContainText("days old");
  await expect(page.getByRole("button", { name: "Link newer evidence" })).toBeVisible();
});

test("the picker lists every piece with a tick box, and searching narrows it", async ({ page }) => {
  const c = await implementedControl(page, 6);
  for (let i = 1; i <= 10; i++) await evidence(page, `Evidence test: bulk item ${i}`, daysAgo(i));
  await openOnThread(page, c.id);
  await page.getByRole("button", { name: "Link existing evidence" }).click();
  await expect(page.locator(".gt-linker .lp-opt").filter({ hasText: "bulk item" })).toHaveCount(10);
  await expect(page.locator(".gt-linker .lp-opt input[type=checkbox]").first()).toBeVisible();
  await page.locator(".gt-linker .lp-search").fill("bulk item 10");
  await expect(page.locator(".gt-linker .lp-opt")).toHaveCount(1);
});

test("Add new evidence opens the control's own Evidence section, and returns to the thread", async ({ page }) => {
  const c = await implementedControl(page, 7);
  await openOnThread(page, c.id);
  await page.getByRole("button", { name: "Link existing evidence" }).click();
  const add = page.locator(".gt-linker").getByRole("link", { name: "Add new evidence" });
  await expect(add).toHaveAttribute("href", new RegExp(`#/controls/${c.id}[?]fix=evidence&back=thread`));
  await add.click();
  await expect(page.locator(".modal")).toContainText(c.ref);
  await expect(page.locator('.modal [data-fix="evidence"]')).toBeInViewport();
  await page.locator(".modal").getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/#\/risks\/thread$/);
});
