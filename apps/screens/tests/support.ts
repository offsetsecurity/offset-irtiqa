import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";

export const ADMIN = { username: "screens-admin", name: "Screen Tester", email: "screens@example.test", password: "a-long-screen-test-passphrase" };

export interface Pack {
  id: string;
  product: string;
  framework: string;
  contact?: string;
  features: Record<string, boolean>;
}

/** This product's pack, as the server reads it. */
export const pack: Pack = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../packs", process.env["PRODUCT"]!, "pack.json"), "utf8"),
);

export const has = (feature: string): boolean => pack.features[feature] === true;

/** Signs in through the API, which sets the same cookies the form would. */
export async function signIn(page: Page): Promise<void> {
  const login = { data: { username: ADMIN.username, password: ADMIN.password } };
  let res = await page.request.post("/api/v1/auth/login", login);
  // A file run on its own starts on an empty install: make the administrator first.
  if (res.status() === 401) {
    await page.request.post("/api/v1/auth/bootstrap", { data: ADMIN });
    res = await page.request.post("/api/v1/auth/login", login);
  }
  expect(res.status(), "test administrator can sign in").toBe(200);
}

/** Opens a screen and waits for the app to draw it. */
export async function open(page: Page, hash: string): Promise<void> {
  await page.goto(`/#/${hash}`);
  await expect(page.locator(".topbar h1")).toBeVisible();
}

/** Fails on anything the page itself reported as broken. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|401|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
  return errors;
}
