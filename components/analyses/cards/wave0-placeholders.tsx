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

// M7 wave-1 placeholders — replace with real implementations as each card lands.
export const UpSetResult       = makePlaceholder("A3_multiselect_upset",    "Multi-select Co-occurrence");
export const NgramResult        = makePlaceholder("A6_text_ngrams",          "Open-text N-grams");
export const WeightedResult     = makePlaceholder("A7_weighted_vs_unweighted","Weighted vs Unweighted Estimates");
export const ChoroplethResult   = makePlaceholder("A12_choropleth_agg",      "Choropleth Aggregation");
export const StraightLineResult = makePlaceholder("A35_straight_line",       "Straight-lining Detector");
export const WhosMissingResult  = makePlaceholder("A41_whos_missing",        "Who’s Missing");
export const LorenzResult       = makePlaceholder("A42_lorenz",              "Coverage Equity (Lorenz / Gini)");
export const RakingResult       = makePlaceholder("A43_raking_diag",         "Raking Weights Diagnostic");
export const SegmentDiffResult  = makePlaceholder("A46_segment_diff",        "Auto-detected Segment Differences");
