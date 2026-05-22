import { test, expect } from "@playwright/test";

test("sign-up page renders form fields", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
});
