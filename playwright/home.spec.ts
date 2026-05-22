import { test, expect } from "@playwright/test";

test("unauthenticated home redirects to sign-in", async ({ page }) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/sign-in/);
});
