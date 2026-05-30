import { NextResponse } from "next/server";
import { getAaporResult } from "@/lib/queries/aapor";
import { getCoverageBlocks, getUndersampledBlocks } from "@/lib/queries/universe-coverage";
import { getRefusalPattern } from "@/lib/queries/refusal-pattern";
import { getProductivity, getGpsOutliers } from "@/lib/queries/productivity";
import { getOffBoundary } from "@/lib/queries/off-boundary";
import { getDemographicsSchema } from "@/lib/queries/representativeness";
import { getTopKBlocks } from "@/lib/queries/topk-blocks";
import { getF1Queue } from "@/lib/queries/f1-queue";

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

const SIDECAR_PENDING = new Set(["A21_finish", "A25_velocity", "A11_kde", "A8_gi_star"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; cardId: string }> },
) {
  const { projectId, cardId } = await params;

  if (SIDECAR_PENDING.has(cardId)) {
    return NextResponse.json({
      data: null,
      status: "sidecar_pending",
      computedAt: new Date().toISOString(),
    });
  }

  const handler = POSTGRES_DISPATCH[cardId];
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
