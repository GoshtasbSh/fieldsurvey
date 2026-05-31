// components/analyses/results/index.ts
import type { ComponentType } from "react";
import { A0Result } from "./a0-result";
import { S1Result } from "./s1-result";
import { S2Result } from "./s2-result";
import { S3Result } from "./s3-result";
import { S4Result } from "./s4-result";
import { S5Result } from "./s5-result";
import { S6Result } from "./s6-result";
import { S7Result } from "./s7-result";
import { S8Result } from "./s8-result";

type ResultPanel = ComponentType<{ data: unknown }>;

const RESULT_PANELS: Record<string, ResultPanel> = {
  A0_colorizer: A0Result,
  S1_autocorr: S1Result,
  S2_gi_star_q: S2Result,
  S3_lisa_q: S3Result,
  S4_satscan: S4Result,
  S5_distance_decay: S5Result,
  S6_coverage_response: S6Result,
  S7_local_geary: S7Result,
  S8_bivariate: S8Result,
};

export function getResultPanel(cardId: string): ResultPanel | null {
  return RESULT_PANELS[cardId] ?? null;
}
