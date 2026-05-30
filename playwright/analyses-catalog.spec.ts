import { test, expect } from "@playwright/test";

// Smoke test for the M7 wave-1 Analyses Catalog. These assertions are
// import-shape only — they don't hit a browser surface, so they run fast
// even when the dev server is up. They guard against accidental commenting
// of registry entries or renamed exports in viz-registry.

test.describe("Analyses Catalog", () => {
  test("registry exports at least 53 catalog cards including the wave-1 set", async () => {
    const { ANALYSES_REGISTRY, CATALOG_COUNT } = await import(
      "../lib/analyses/registry"
    );
    expect(CATALOG_COUNT).toBeGreaterThanOrEqual(53);
    const ids = ANALYSES_REGISTRY.map((c) => c.id);
    for (const expected of [
      "A0_colorizer",
      "match_donut",
      "A16_rr",
      "A21_finish",
      "A25_velocity",
      "A11_kde",
      "A8_gi_star",
      "A39_freshness",
      "A51_topk",
      "A52_f1_queue",
    ]) {
      expect(ids).toContain(expected);
    }
  });

  test("default pack contains the research-backed seed set", async () => {
    const { ANALYSES_REGISTRY } = await import("../lib/analyses/registry");
    const defaultPack = ANALYSES_REGISTRY.filter((c) => c.defaultPack).map(
      (c) => c.id,
    );
    expect(defaultPack.length).toBeGreaterThanOrEqual(10);
    expect(defaultPack).toContain("A16_rr");
    expect(defaultPack).toContain("A21_finish");
    expect(defaultPack).toContain("A23_hour_local");
  });

  test("viz-registry exposes every wave-1 component name", async () => {
    const { VIZ_REGISTRY } = await import("../lib/analyses/viz-registry");
    const keys = Object.keys(VIZ_REGISTRY);
    for (const expected of [
      "FreshnessChip",
      "HourHistogram",
      "DowHourHeatmap",
      "MatchDonut",
      "AaporRatesPanel",
      "MonteCarloFan",
      "VelocityLineCI",
      "KdeRaster",
      "SignificanceChoropleth",
      "UniverseMap",
      "TopKBlocks",
    ]) {
      expect(keys).toContain(expected);
    }
  });
});
