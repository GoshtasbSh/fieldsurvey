import { test, expect } from "@playwright/test";

test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "needs Supabase env");

test("landing page is reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /get started/i })).toBeVisible();
});

test("sign-up page is reachable", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
});

test("sign-in page is reachable", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("home redirects unauth to sign-in", async ({ page }) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/sign-in/);
});
