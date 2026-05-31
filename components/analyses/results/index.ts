// components/analyses/results/index.ts
import type { ComponentType } from "react";
import { A0Result } from "./a0-result";
import { A3Result } from "./a3-result";
import { A6Result } from "./a6-result";
import { A7Result } from "./a7-result";
import { A12Result } from "./a12-result";
import { A35Result } from "./a35-result";
import { A41Result } from "./a41-result";
import { A42Result } from "./a42-result";
import { A43Result } from "./a43-result";
import { A46Result } from "./a46-result";
import { S1Result } from "./s1-result";
import { S2Result } from "./s2-result";
import { S3Result } from "./s3-result";
import { S4Result } from "./s4-result";
import { S5Result } from "./s5-result";
import { S6Result } from "./s6-result";
import { S7Result } from "./s7-result";
import { S8Result } from "./s8-result";
import { V2SpaceTimeResult } from "./v2-space-time-result";
import { V2SpatialRegResult } from "./v2-spatial-reg-result";
import { V2SegregationResult } from "./v2-segregation-result";

type ResultPanel = ComponentType<{ data: unknown }>;

const RESULT_PANELS: Record<string, ResultPanel> = {
  A0_colorizer: A0Result,
  A3_multiselect_upset: A3Result,
  A6_text_ngrams: A6Result,
  A7_weighted_vs_unweighted: A7Result,
  A12_choropleth_agg: A12Result,
  A35_straight_line: A35Result,
  A41_whos_missing: A41Result,
  A42_lorenz: A42Result,
  A43_raking_diag: A43Result,
  A46_segment_diff: A46Result,
  S1_autocorr: S1Result,
  S2_gi_star_q: S2Result,
  S3_lisa_q: S3Result,
  S4_satscan: S4Result,
  S5_distance_decay: S5Result,
  S6_coverage_response: S6Result,
  S7_local_geary: S7Result,
  S8_bivariate: S8Result,
  V2_emerging_hot: V2SpaceTimeResult,
  V2_gwr: V2SpatialRegResult,
  V2_segregation: V2SegregationResult,
};

export function getResultPanel(cardId: string): ResultPanel | null {
  return RESULT_PANELS[cardId] ?? null;
}
