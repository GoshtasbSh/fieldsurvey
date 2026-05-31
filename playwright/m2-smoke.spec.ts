import { test, expect } from "@playwright/test";

test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "needs Supabase env");

const FAKE_PROJECT = "00000000-0000-0000-0000-000000000001";

test.describe("M2 smoke — routes and API security", () => {
  // For a non-existent project, the outer layout calls notFound() before
  // any auth redirect — that's correct behavior (don't leak project
  // existence to anyone). We just verify the page renders some response
  // and doesn't 500.
  for (const path of ["/map", "/field", "/import", "/points", "/settings"] as const) {
    test(`/p/[id]${path} renders without crashing for unknown project`, async ({ page }) => {
      const res = await page.goto(`/p/${FAKE_PROJECT}${path}`);
      expect(res?.status() ?? 0).toBeLessThan(500);
    });
  }

  test("api/points POST without auth returns 401", async ({ request }) => {
    const r = await request.post("/api/points", {
      data: { project_id: FAKE_PROJECT, status_id: "00000000-0000-0000-0000-000000000002", lat: 0, lon: 0, client_id: "test" },
    });
    expect(r.status()).toBe(401);
  });

  test("api/responses/import POST without auth returns 401", async ({ request }) => {
    const r = await request.post("/api/responses/import", {
      data: { project_id: FAKE_PROJECT, filename: "x.csv", address_column: "Address", rows: [{ Address: "1 Main St" }] },
    });
    expect(r.status()).toBe(401);
  });

  test("api/match POST without auth returns 401", async ({ request }) => {
    const r = await request.post(`/api/match?project_id=${FAKE_PROJECT}`);
    expect(r.status()).toBe(401);
  });

  test("api/projects/[id]/statuses PUT without auth returns 401", async ({ request }) => {
    const r = await request.put(`/api/projects/${FAKE_PROJECT}/statuses`, {
      data: { statuses: [{ id: "x", label: "X", color: "#34d399", sort_order: 0 }] },
    });
    expect(r.status()).toBe(401);
  });

  test("api/geocode reverse without auth returns 401", async ({ request }) => {
    const r = await request.get("/api/geocode?reverse=1&lat=29.65&lon=-82.32");
    expect(r.status()).toBe(401);
  });

  test("PWA manifest is served", async ({ request }) => {
    const r = await request.get("/manifest.json");
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(j.name).toBe("FieldSurvey");
    expect(j.display).toBe("standalone");
  });

  test("service worker script is served", async ({ request }) => {
    const r = await request.get("/sw.js");
    expect(r.ok()).toBeTruthy();
    expect(await r.text()).toContain("fs-tiles");
  });
});
