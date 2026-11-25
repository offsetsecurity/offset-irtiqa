import { test, expect } from "@playwright/test";
import { signIn, open } from "./support.js";

/**
 * Every screen sits in the menu section it belongs to, in an order a person
 * can learn: the things a risk attaches to follow Risks; what an auditor
 * reads (audits and reviews, findings, gaps, reports) is under Audit.
 */
test.beforeEach(async ({ page }) => { await signIn(page); });

test("Menu: each screen is in the right section, in the right order", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "dashboard");
  const menu = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>(".nav-section")].map((s) => [
        s.dataset["id"] ?? "",
        [...s.querySelectorAll<HTMLAnchorElement>(".nav-items a")].map((a) => (a.getAttribute("href") ?? "").replace("#/", "")),
      ]),
    ),
  );
  expect(menu["start"]).toEqual(["getready", "dashboard"]);
  // Offset Irtiqa has no set-up screens of its own (no ISMS or Statement of Applicability).
  expect(menu["compliance"]).toEqual(["controls", "policies", "evidence"]);
  expect(menu["risk"]).toEqual(["risks", "assets", "thread", "vendors"]);
  expect(menu["work"]).toEqual(["tasks", "calendar", "incidents"]);
  // A maturity product has no Gap analysis screen: its gaps are the maturity levels below target.
  expect(menu["reports"]).toEqual(["auditor", "reviews", "findings", "reports"]);
  expect(menu["management"]).toEqual(["training", "objectives", "parties", "communications"]);
  expect(menu["admin"]).toEqual(["people", "escalation", "audit", "backups"]);
});

test("Golden thread opens on Only problems, like every Offset product", async ({ page }) => {
  // The map has nothing to filter until there is a risk.
  await open(page, "risks");
  await page.evaluate(async () => {
    const csrf = /offset_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? "";
    await fetch("/api/v1/risks", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ title: "A risk for the Golden thread", likelihood: 3, impact: 3 }) });
  });
  await open(page, "risks/thread");
  await expect(page.getByRole("button", { name: "Only problems" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Everything" })).toHaveAttribute("aria-pressed", "false");
});
