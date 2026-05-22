import { test, expect } from "@playwright/test";

test("sign-in page renders form fields", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /create.*account/i })).toBeVisible();
});
