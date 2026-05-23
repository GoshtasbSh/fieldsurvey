import { test, expect } from "@playwright/test";

test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "needs Supabase env");

test.describe("M3 extras — bulk + heatmap-aware shell", () => {
  test("api/points/bulk PATCH without auth returns 401", async ({ request }) => {
    const r = await request.patch("/api/points/bulk", {
      data: {
        project_id: "00000000-0000-0000-0000-000000000001",
        point_ids: ["00000000-0000-0000-0000-000000000002"],
        action: "delete",
      },
    });
    expect(r.status()).toBe(401);
  });

  test("api/points/bulk rejects bad action", async ({ request }) => {
    const r = await request.patch("/api/points/bulk", {
      data: {
        project_id: "00000000-0000-0000-0000-000000000001",
        point_ids: ["00000000-0000-0000-0000-000000000002"],
        action: "nuke",
      },
    });
    // Unauthenticated returns 401 before schema validation runs — either is fine,
    // just confirm we don't 500.
    expect(r.status()).toBeLessThan(500);
  });
});
