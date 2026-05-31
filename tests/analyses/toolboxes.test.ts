// tests/analyses/toolboxes.test.ts
import { describe, it, expect } from "vitest";
import { TOOLBOXES, v1Toolboxes, v2Toolboxes } from "@/lib/analyses/toolboxes";

describe("toolboxes", () => {
  it("ships 5 v1 toolboxes in spec order", () => {
    expect(v1Toolboxes().map(t => t.slug)).toEqual([
      "symbology", "analyzing_patterns", "mapping_clusters",
      "spatial_relationships", "coverage_equity",
    ]);
  });

  it("ships 3 v2 placeholder toolboxes", () => {
    expect(v2Toolboxes().map(t => t.slug)).toEqual([
      "space_time", "spatial_regression", "sampling_equity",
    ]);
  });

  it("every toolbox has an icon + non-empty description", () => {
    for (const t of TOOLBOXES) {
      expect(t.icon.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(10);
    }
  });
});
