// e2e/spatial-toolbox.spec.ts
import { test, expect } from "@playwright/test";

const PROJECT_URL = process.env.FS_E2E_PROJECT_URL
  ?? "http://localhost:3000/p/40971687-2585-4391-8650-303483900517/map";

test.describe("Spatial Analysis Toolbox (Wave 0)", () => {
  test("admin opens Analyze tab → Add modal → picks a card → row appears in list → opens settings", async ({ page }) => {
    await page.goto(PROJECT_URL);
    await page.getByRole("tab", { name: /Analyze/ }).click();

    await page.getByRole("button", { name: /Add spatial analysis/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Default toolbox = Symbology; click "Mapping Clusters"
    await page.getByRole("tab", { name: /Mapping Clusters/ }).click();
    await expect(page.getByText(/Hot\/Cold Spot/i)).toBeVisible();

    // Add S2
    await page.getByRole("button", { name: /Add Hot\/Cold Spot.* to Analyze tab/i }).first().click();

    // Row appears in the list
    await expect(page.getByText(/^S2_gi_star_q$/)).toBeVisible();

    // Open settings → drawer shows FDR alpha + permutations
    await page.getByRole("button", { name: /Open settings for Hot\/Cold Spot/i }).click();
    await expect(page.getByLabel(/FDR alpha/i)).toBeVisible();
    await expect(page.getByText(/Permutations/i)).toBeVisible();
  });

  test("v2 toolboxes are visible but greyed (aria-disabled)", async ({ page }) => {
    await page.goto(PROJECT_URL);
    await page.getByRole("tab", { name: /Analyze/ }).click();
    await page.getByRole("button", { name: /Add spatial analysis/i }).click();

    const v2 = page.getByRole("tab", { name: /Space-Time/ });
    await expect(v2).toBeVisible();
    await expect(v2).toHaveAttribute("aria-disabled", "true");
  });
});
