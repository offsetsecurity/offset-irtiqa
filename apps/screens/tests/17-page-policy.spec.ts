import { test, expect } from "@playwright/test";
import { signIn, open } from "./support.js";

/**
 * The page policy refuses inline styles (PR 30). Anything that still writes a
 * style attribute into HTML or SVG it builds as text is blocked by the browser
 * and silently loses its look: the Golden thread lost its red, amber and green
 * that way (found 15 Nov 2026). Every screen in the menu is opened and must
 * cause no policy violation at all.
 */
test.beforeEach(async ({ page }) => { await signIn(page); });

test("The Golden thread's warnings keep their colour", async ({ page }) => {
  // A control marked in place, treating a risk, with no evidence: the map says "no evidence" in red.
  await open(page, "risks");
  await page.evaluate(async () => {
    const csrf = /offset_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? "";
    const h = { "content-type": "application/json", "x-csrf-token": csrf };
    const risk = (await (await fetch("/api/v1/risks", { method: "POST", headers: h, body: JSON.stringify({ title: "A risk for the colour check", likelihood: 4, impact: 4 }) })).json()) as { risk?: { id: string }; id?: string };
    const riskId = risk.risk?.id ?? risk.id;
    const controls = ((await (await fetch("/api/v1/controls")).json()) as { controls: { id: string; ref: string }[] }).controls;
    const control = controls.find((c) => c.ref === "A.8.34") ?? controls[controls.length - 1]!;
    await fetch(`/api/v1/controls/${control.id}/risks`, { method: "PUT", headers: h, body: JSON.stringify({ riskIds: [riskId] }) });
    await fetch(`/api/v1/controls/${control.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ status: "implemented" }) });
  });
  await open(page, "risks/thread");
  const red = page.locator("svg text", { hasText: "no evidence" }).first();
  await expect(red).toBeVisible();
  const redToken = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--red").trim());
  // The token is a hex colour; the computed fill is rgb(). Compare as rgb.
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(redToken);
  expect(hex).not.toBeNull();
  const want = `rgb(${parseInt(hex![1]!, 16)}, ${parseInt(hex![2]!, 16)}, ${parseInt(hex![3]!, 16)})`;
  // The map may be drawn again once its data arrives: read the colour until it settles.
  await expect.poll(() => page.locator("svg text", { hasText: "no evidence" }).first().evaluate((el) => getComputedStyle(el).fill)).toBe(want);
});

// Runs after the colour check, so the map has its red note to draw.
test("No screen breaks the page policy", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    (window as unknown as { __violations: string[] }).__violations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __violations: string[] }).__violations.push(`${e.violatedDirective} ${e.sourceFile}:${e.lineNumber} ${e.sample}`);
    });
  });
  // A risk nothing treats, so the Golden thread draws its red note.
  await open(page, "risks");
  await page.evaluate(async () => {
    const csrf = /offset_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? "";
    await fetch("/api/v1/risks", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ title: "A risk nothing treats yet", likelihood: 4, impact: 4 }) });
  });
  const screens = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>(".nav-items a")].map((a) => (a.getAttribute("href") ?? "").replace("#/", "")).filter(Boolean),
  );
  expect(screens.length).toBeGreaterThan(20);
  const broken: string[] = [];
  for (const hash of [...screens, "risks/thread"]) {
    await open(page, hash);
    await page.waitForTimeout(300);
    const v = await page.evaluate(() => (window as unknown as { __violations: string[] }).__violations.splice(0));
    if (v.length) broken.push(`${hash}: ${v.join(" | ")}`);
    // The browser does not always report a style attribute it refused inside
    // markup drawn as text, so look for one directly: any SVG part carrying a
    // style attribute was drawn that way and has lost its look.
    const styled = await page.evaluate(() => [...document.querySelectorAll("svg [style]")].map((el) => `<${el.tagName} style="${el.getAttribute("style")}">`));
    if (styled.length) broken.push(`${hash}: ${styled.slice(0, 3).join(" ")}`);
  }
  expect(broken).toEqual([]);
});
