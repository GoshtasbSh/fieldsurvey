// tests/analyses/spatial-cards.test.ts
import { describe, it, expect } from "vitest";
import { getCardById } from "@/lib/analyses/registry";
import type { SpatialCardCatalogEntry } from "@/lib/analyses/types";

const SPATIAL_IDS = [
  "A0_colorizer", "S1_autocorr", "S2_gi_star_q",
  "S3_lisa_q", "S4_satscan",
  "S5_distance_decay", "S6_coverage_response",
  "S7_local_geary", "S8_bivariate",
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

describe("S5-S8 toolbox assignments", () => {
  it("S5 → spatial_relationships", () => {
    const c = getCardById("S5_distance_decay") as SpatialCardCatalogEntry;
    expect(c.toolbox).toBe("spatial_relationships");
  });
  it("S6 → coverage_equity", () => {
    const c = getCardById("S6_coverage_response") as SpatialCardCatalogEntry;
    expect(c.toolbox).toBe("coverage_equity");
  });
  it("S7 → mapping_clusters", () => {
    expect((getCardById("S7_local_geary") as SpatialCardCatalogEntry).toolbox).toBe("mapping_clusters");
  });
  it("S8 → spatial_relationships", () => {
    expect((getCardById("S8_bivariate") as SpatialCardCatalogEntry).toolbox).toBe("spatial_relationships");
  });
});
