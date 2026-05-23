import { test, expect } from "@playwright/test";

test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "needs Supabase env");

const FAKE_PROJECT = "00000000-0000-0000-0000-000000000001";

test.describe("M3 smoke — chat, public, caps, notifications", () => {
  test("api/chat POST without auth returns 401", async ({ request }) => {
    const r = await request.post("/api/chat", { data: { project_id: FAKE_PROJECT, body: "hi" } });
    expect(r.status()).toBe(401);
  });

  test("api/projects/[id]/visibility PUT without auth returns 401", async ({ request }) => {
    const r = await request.put(`/api/projects/${FAKE_PROJECT}/visibility`, { data: { visibility: "public_read" } });
    expect(r.status()).toBe(401);
  });

  test("api/account/notifications PUT without auth returns 401", async ({ request }) => {
    const r = await request.put("/api/account/notifications", {
      data: { email_invites: true, email_role: true, email_digest: false, email_caps: true },
    });
    expect(r.status()).toBe(401);
  });

  test("/public/[id] renders for unknown project (returns 404 page, not crash)", async ({ page }) => {
    const res = await page.goto(`/public/${FAKE_PROJECT}`);
    expect(res?.status() ?? 0).toBeLessThan(500);
  });

  test("/p/[id]/responses requires auth without crashing", async ({ page }) => {
    const res = await page.goto(`/p/${FAKE_PROJECT}/responses`);
    expect(res?.status() ?? 0).toBeLessThan(500);
  });

  test("/account/notifications redirects unauth to sign-in", async ({ page }) => {
    await page.goto("/account/notifications");
    await expect(page).toHaveURL(/sign-in/);
  });
});
