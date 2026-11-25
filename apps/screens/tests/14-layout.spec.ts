import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./support.js";

/**
 * Every screen fits at the three sizes the program checks (LAY-REQ-001 to
 * 003, REVIEW-001 F-17 to F-19): no sideways page scroll, a top bar on one
 * line, and a menu that never scrolls inside itself.
 */
const SIZES = [
  { width: 1440, height: 900 },
  { width: 1100, height: 800 },
  { width: 900, height: 700 },
];

const SCREENS = [
  "getready", "dashboard", "isms", "profile", "soa", "system", "controls", "evidence", "policies",
  "risks", "auditor", "assets", "calendar", "tasks", "incidents", "findings", "vendors", "training", "objectives",
  "parties", "reviews", "communications", "reports", "gaps", "people", "escalation", "audit", "backups",
  "settings", "guides", "help",
];

async function measure(page: Page): Promise<{ sideways: boolean; topbar: number; menuOver: number }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.querySelector("main")!;
    const nav = document.querySelector(".nav.scroll");
    return {
      sideways: doc.scrollWidth > doc.clientWidth || main.scrollWidth > main.clientWidth + 1,
      topbar: document.querySelector(".topbar")!.getBoundingClientRect().height,
      menuOver: nav ? nav.scrollHeight - nav.clientHeight : 0,
    };
  });
}

for (const size of SIZES) {
  test(`every screen fits at ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(size);
    await signIn(page);
    await page.goto("/#/getready");
    await expect(page.locator(".topbar h1")).toBeVisible();
    const problems: string[] = [];
    for (const screen of SCREENS) {
      await page.evaluate((h) => { window.location.hash = h; }, `#/${screen}`);
      const h1 = page.locator(".topbar h1");
      await expect(h1).toBeVisible();
      // Let the screen's data arrive and draw.
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(250);
      if (!(await page.evaluate((s) => window.location.hash === `#/${s}`, screen))) continue; // not in this product
      const m = await measure(page);
      if (m.sideways) problems.push(`${screen}: scrolls sideways`);
      if (m.topbar > 90) problems.push(`${screen}: top bar wraps (${Math.round(m.topbar)} px)`);
      if (m.menuOver > 1) problems.push(`${screen}: menu scrolls inside itself by ${m.menuOver} px`);
    }
    expect(problems).toEqual([]);
  });
}
