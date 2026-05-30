import { NextResponse } from "next/server";
import { getAaporResult } from "@/lib/queries/aapor";
import { getCoverageBlocks, getUndersampledBlocks } from "@/lib/queries/universe-coverage";
import { getRefusalPattern } from "@/lib/queries/refusal-pattern";
import { getProductivity, getGpsOutliers } from "@/lib/queries/productivity";
import { getOffBoundary } from "@/lib/queries/off-boundary";
import { getDemographicsSchema } from "@/lib/queries/representativeness";
import { getTopKBlocks } from "@/lib/queries/topk-blocks";
import { getF1Queue } from "@/lib/queries/f1-queue";
import { callSidecar } from "@/lib/queries/sidecar";
import {
  buildA21FinishInput,
  buildA25VelocityInput,
  buildA11KdeInput,
  buildA8GiStarInput,
} from "@/lib/queries/sidecar-inputs";

export const dynamic = "force-dynamic";

const POSTGRES_DISPATCH: Record<string, (projectId: string) => Promise<unknown>> = {
  A16_rr: getAaporResult,
  A17_coop_ref: getAaporResult,
  A18_con: getAaporResult,
  A13_cov_heatmap: getCoverageBlocks,
  A19_universe_map: getCoverageBlocks,
  A20_undersampled: getUndersampledBlocks,
  A22_refusal_pattern: getRefusalPattern,
  A28_productivity: getProductivity,
  A29_gps_outlier: getGpsOutliers,
  A33_off_boundary: getOffBoundary,
  A40_sample_vs_acs: getDemographicsSchema,
  A51_topk: getTopKBlocks,
  A52_f1_queue: getF1Queue,
};

const SIDECAR_DISPATCH: Record<string, (projectId: string) => Promise<unknown>> = {
  A21_finish: async (projectId) => {
    const body = await buildA21FinishInput(projectId);
    return callSidecar(projectId, "A21_finish", body);
  },
  A25_velocity: async (projectId) => {
    const body = await buildA25VelocityInput(projectId);
    return callSidecar(projectId, "A25_velocity", body);
  },
  A11_kde: async (projectId) => {
    const body = await buildA11KdeInput(projectId);
    return callSidecar(projectId, "A11_kde", body);
  },
  A8_gi_star: async (projectId) => {
    const body = await buildA8GiStarInput(projectId);
    return callSidecar(projectId, "A8_gi_star", body);
  },
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; cardId: string }> },
) {
  const { projectId, cardId } = await params;

  const handler = POSTGRES_DISPATCH[cardId] ?? SIDECAR_DISPATCH[cardId];
  if (!handler) {
    return NextResponse.json({ error: "unknown card" }, { status: 404 });
  }

  try {
    const data = await handler(projectId);
    return NextResponse.json({ data, computedAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
