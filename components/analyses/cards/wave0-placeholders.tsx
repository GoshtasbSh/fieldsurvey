// components/analyses/cards/wave0-placeholders.tsx
"use client";
import { AwaitingDataPanel } from "@/components/analyses/awaiting-data-panel";

function makePlaceholder(cardId: string, cardName: string) {
  function Placeholder() {
    return <AwaitingDataPanel cardName={cardName} cardId={cardId} reason="wave-pending" />;
  }
  Placeholder.displayName = `Placeholder(${cardId})`;
  return Placeholder;
}

export const A0ColorizerPlaceholder = makePlaceholder("A0_colorizer", "Question Colorizer");
export const S1Placeholder = makePlaceholder("S1_autocorr", "Spatial Autocorrelation");
export const S2Placeholder = makePlaceholder("S2_gi_star_q", "Hot/Cold Spot (Gi*)");
export const S3Placeholder = makePlaceholder("S3_lisa_q", "Cluster & Outlier (LISA)");
export const S4Placeholder = makePlaceholder("S4_satscan", "Spatial Scan (Kulldorff)");
export const S5Placeholder = makePlaceholder("S5_distance_decay", "Distance-Decay vs POI");
export const S6Placeholder = makePlaceholder("S6_coverage_response", "Coverage × Response");
export const S7Placeholder = makePlaceholder("S7_local_geary", "Local Geary Heterogeneity");
export const S8Placeholder = makePlaceholder("S8_bivariate", "Bivariate (Lee's L)");
export const V2Placeholder = makePlaceholder("v2", "Coming in v2");
