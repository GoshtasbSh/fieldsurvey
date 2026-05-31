// tests/analyses/spatial-cards.test.ts
import { describe, it, expect } from "vitest";
import { getCardById } from "@/lib/analyses/registry";
import type { SpatialCardCatalogEntry } from "@/lib/analyses/types";

const SPATIAL_IDS = [
  "A0_colorizer", "S1_autocorr", "S2_gi_star_q",
  "S3_lisa_q", "S4_satscan",
];

describe("spatial-cards wave 0 catalog (A0 + S1-S4)", () => {
  it.each(SPATIAL_IDS)("%s has spatial-catalog-entry fields", (id) => {
    const c = getCardById(id) as SpatialCardCatalogEntry | undefined;
    expect(c, `${id} missing`).toBeDefined();
    expect(c!.toolbox).toBeTruthy();
    expect(c!.previewImage.src).toMatch(/^\/analyses-previews\//);
    expect(c!.questionsAnswered.length).toBeGreaterThan(0);
    expect(c!.whatItDoes.length).toBeGreaterThan(20);
    expect(c!.inputRequirements.length).toBeGreaterThan(0);
    expect(c!.settingsSchema.length).toBeGreaterThan(0);
  });

  it("A0 toolbox is symbology", () => {
    const c = getCardById("A0_colorizer") as SpatialCardCatalogEntry;
    expect(c.toolbox).toBe("symbology");
  });

  it("S2 / S3 / S4 toolbox is mapping_clusters", () => {
    expect((getCardById("S2_gi_star_q") as SpatialCardCatalogEntry).toolbox).toBe("mapping_clusters");
    expect((getCardById("S3_lisa_q") as SpatialCardCatalogEntry).toolbox).toBe("mapping_clusters");
    expect((getCardById("S4_satscan") as SpatialCardCatalogEntry).toolbox).toBe("mapping_clusters");
  });
});
