// tests/analyses/toolboxes.test.ts
import { describe, it, expect } from "vitest";
import { TOOLBOXES, v1Toolboxes, v2Toolboxes } from "@/lib/analyses/toolboxes";

describe("toolboxes", () => {
  it("ships 10 v1 toolboxes in spec order", () => {
    expect(v1Toolboxes().map(t => t.slug)).toEqual([
      "symbology", "analyzing_patterns", "mapping_clusters",
      "spatial_relationships", "coverage_equity",
      "survey_response", "quality_bias",
      "space_time", "spatial_regression", "sampling_equity",
    ]);
  });

  it("ships 0 v2 placeholder toolboxes (all promoted to v1)", () => {
    expect(v2Toolboxes()).toHaveLength(0);
  });

  it("every toolbox has an icon + non-empty description", () => {
    for (const t of TOOLBOXES) {
      expect(t.icon.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(10);
    }
  });
});
