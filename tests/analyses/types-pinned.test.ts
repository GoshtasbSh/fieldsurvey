// tests/analyses/types-pinned.test.ts
import { describe, it, expect } from "vitest";
import type { PinnedAnalysisLayer } from "@/lib/analyses/types";

describe("PinnedAnalysisLayer type", () => {
  it("compiles with all required fields", () => {
    const layer: PinnedAnalysisLayer = {
      cardId: "S2_gi_star_q",
      layerName: "Hot spots",
      settings: { fdrAlpha: 0.05 },
      visible: true,
      pinnedAt: "2026-05-31T10:00:00Z",
    };
    expect(layer.cardId).toBe("S2_gi_star_q");
    expect(layer.visible).toBe(true);
  });

  it("allows optional cachedResult and cachedAt", () => {
    const layer: PinnedAnalysisLayer = {
      cardId: "S1_autocorr",
      layerName: "Autocorr",
      settings: {},
      visible: false,
      pinnedAt: "2026-05-31T10:00:00Z",
      cachedResult: { moran: { I: 0.32, z: 4.1, p: 0.001 }, verdict: "clustered" },
      cachedAt: "2026-05-31T10:05:00Z",
    };
    expect(layer.visible).toBe(false);
    expect(layer.cachedResult).toBeDefined();
  });
});
