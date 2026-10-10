import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ADMIN, pack } from "./support.js";

test.describe.configure({ mode: "serial" });

test("a new install asks for the first administrator, and signs them in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("No accounts exist yet")).toBeVisible();
  await page.locator('input[name="username"]').fill(ADMIN.username);
  await page.locator('input[name="name"]').fill(ADMIN.name);
  await page.locator('input[name="email"]').fill(ADMIN.email);
  await page.locator('input[name="password"]').fill(ADMIN.password);
  await page.getByRole("button", { name: "Create administrator" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".sidebar-user")).toContainText(ADMIN.name);
});

test("a wrong password is refused with one plain message, and written to signin.log", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[name="username"]').fill(ADMIN.username);
  await page.locator('input[name="password"]').fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Incorrect username or password.");
  const log = join(process.env["SCREENS_DATA"]!, "logs", "signin.log");
  await expect.poll(() => existsSync(log) && readFileSync(log, "utf8")).toContain(`user=${ADMIN.username}`);
  expect(readFileSync(log, "utf8")).not.toContain("not-the-password");
});

test("the right password signs in, and Sign out signs out", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[name="username"]').fill(ADMIN.username);
  await page.locator('input[name="password"]').fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".topbar")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("the sign-in page says which product this is", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".login")).toContainText(pack.product.replace(/^Offset\s+/, ""), { ignoreCase: true });
});
