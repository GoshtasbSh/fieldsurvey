// tests/analyses/types-compile.test.ts
import { describe, it, expect } from "vitest";
import type {
  SpatialCardCatalogEntry,
  SettingSchema,
  ToolboxSlug,
  PreviewImage,
  AnalysisListItem,
} from "@/lib/analyses/types";

describe("types contract", () => {
  it("SpatialCardCatalogEntry shape compiles", () => {
    const entry: SpatialCardCatalogEntry = {
      id: "S2_gi_star_q",
      section: "spatial",
      name: "Hot/Cold Spot (Gi*)",
      short: "Where are statistically significant clusters?",
      requiredInputs: ["points", "raw_data_key_numeric"],
      nMin: 30,
      roleGate: "member",
      mobileVisible: false,
      computeStrategy: "python_sidecar",
      vizComponent: "GiStarPlaceholder",
      defaultPack: false,
      m7Wave1: false,
      stub: true,
      trustSignals: ["n_units", "fdr_cutoff"],
      pitfalls: ["Without FDR, Gi* over-flags."],
      sourceInspiration: "Getis-Ord 1992; PySAL esda",
      cardOrder: 200,
      toolbox: "mapping_clusters",
      previewImage: {
        src: "/analyses-previews/S2_gi_star_q.jpg",
        alt: "USA unemployment Gi*",
        sourceUrl: "https://commons.wikimedia.org",
        sourceTitle: "Wikimedia Commons",
        license: "CC-BY-4.0",
      },
      questionsAnswered: ["Where are the hot spots?"],
      whatItDoes: "Runs Getis-Ord Gi* with FDR-corrected significance.",
      inputRequirements: ["1 numeric question"],
      settingsSchema: [
        { key: "fdrAlpha", type: "slider", min: 0.01, max: 0.10, step: 0.01, defaultValue: 0.05, label: "FDR alpha" },
      ],
    };
    expect(entry.toolbox).toBe("mapping_clusters");
  });

  it("AnalysisListItem shape compiles", () => {
    const item: AnalysisListItem = {
      cardId: "S2_gi_star_q",
      settings: { fdrAlpha: 0.05 },
      addedAt: "2026-05-30T12:00:00Z",
    };
    expect(item.cardId).toBe("S2_gi_star_q");
  });
});
