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
  buildS1Input,
  buildS2Input,
  buildS3Input,
  buildS4Input,
  buildS5Input,
  buildS7Input,
  buildS8Input,
} from "@/lib/queries/sidecar-inputs";
import { getCoverageResponse } from "@/lib/queries/coverage-response";
import { getColumnValuesById } from "@/lib/queries/columns";
import { defaultSpecFor, resolveBreaks } from "@/lib/colorize/auto-classify";
import { continuousRampStops, categoricalColors } from "@/lib/colorize/palettes";

export const dynamic = "force-dynamic";

// cardId convention: registry format (uppercase snake-case, e.g. A19_universe_map,
// A28_productivity, A51_topk). Cards must fetch `/analyses/<registry-card-id>` —
// the registry in `lib/analyses/registry.ts` is the single source of truth.
const POSTGRES_DISPATCH: Record<string, (projectId: string, settings: Record<string, string>) => Promise<unknown>> = {
  A16_rr: (projectId, _settings) => getAaporResult(projectId),
  A17_coop_ref: (projectId, _settings) => getAaporResult(projectId),
  A18_con: (projectId, _settings) => getAaporResult(projectId),
  A13_cov_heatmap: (projectId, _settings) => getCoverageBlocks(projectId),
  A19_universe_map: (projectId, _settings) => getCoverageBlocks(projectId),
  A20_undersampled: (projectId, _settings) => getUndersampledBlocks(projectId),
  A22_refusal_pattern: (projectId, _settings) => getRefusalPattern(projectId),
  A28_productivity: (projectId, _settings) => getProductivity(projectId),
  A29_gps_outlier: (projectId, _settings) => getGpsOutliers(projectId),
  A33_off_boundary: (projectId, _settings) => getOffBoundary(projectId),
  A40_sample_vs_acs: (projectId, _settings) => getDemographicsSchema(projectId),
  A51_topk: (projectId, _settings) => getTopKBlocks(projectId),
  A52_f1_queue: (projectId, _settings) => getF1Queue(projectId),
  S6_coverage_response: async (projectId, settings) => getCoverageResponse(projectId, settings),
  A0_colorizer: async (projectId, settings) => {
    const qk = settings["questionKey"] ?? settings["questionkey"] ?? "";
    if (!qk) return { error: "missing_question_key" };
    const { profile, valuesByResponseId } = await getColumnValuesById(projectId, qk);
    if (!profile) return { error: "column_not_found" };
    const spec = defaultSpecFor(profile);
    const numericValues: number[] = [];
    for (const v of Object.values(valuesByResponseId)) {
      const n = Number(v);
      if (Number.isFinite(n)) numericValues.push(n);
    }
    const breaks = resolveBreaks(numericValues, spec.classification, spec.classCount);
    const isNumeric = spec.inferredType === "numeric_continuous" || spec.inferredType === "numeric_skewed" || spec.inferredType === "likert" || spec.inferredType === "date";
    const legendColors = isNumeric
      ? continuousRampStops(spec.ramp, spec.classCount, spec.reversed)
      : categoricalColors(spec.ramp, profile.distinct || 1);
    return { spec, profile, breaks, legendColors, n_responses: Object.keys(valuesByResponseId).length };
  },
};

const SIDECAR_DISPATCH: Record<string, (projectId: string, settings: Record<string, string>) => Promise<unknown>> = {
  A21_finish: async (projectId, _settings) => {
    const body = await buildA21FinishInput(projectId);
    return callSidecar(projectId, "A21_finish", body);
  },
  A25_velocity: async (projectId, _settings) => {
    const body = await buildA25VelocityInput(projectId);
    return callSidecar(projectId, "A25_velocity", body);
  },
  A11_kde: async (projectId, _settings) => {
    const body = await buildA11KdeInput(projectId);
    return callSidecar(projectId, "A11_kde", body);
  },
  A8_gi_star: async (projectId, _settings) => {
    const body = await buildA8GiStarInput(projectId);
    return callSidecar(projectId, "A8_gi_star", body);
  },
  S1_autocorr: async (projectId, settings) => {
    const body = await buildS1Input(projectId, settings);
    if (!body) return { reason: "wave-pending", message: "No question selected." };
    return callSidecar(projectId, "S1_autocorr", body);
  },
  S2_gi_star_q: async (projectId, settings) => {
    const body = await buildS2Input(projectId, settings);
    if (!body) return { reason: "wave-pending", message: "No question selected." };
    return callSidecar(projectId, "S2_gi_star_q", body);
  },
  S3_lisa_q: async (projectId, settings) => {
    const body = await buildS3Input(projectId, settings);
    if (!body) return { reason: "wave-pending", message: "No question selected." };
    return callSidecar(projectId, "S3_lisa_q", body);
  },
  S4_satscan: async (projectId, settings) => {
    const body = await buildS4Input(projectId, settings);
    if (!body) return { reason: "wave-pending", message: "No question or answer selected." };
    return callSidecar(projectId, "S4_satscan", body);
  },
  S5_distance_decay: async (projectId, settings) => {
    const body = await buildS5Input(projectId, settings);
    if (!body) return { reason: "wave-pending", message: "No question or POI selected." };
    return callSidecar(projectId, "S5_distance_decay", body);
  },
  S7_local_geary: async (projectId, settings) => {
    const body = await buildS7Input(projectId, settings);
    if (!body) return { reason: "wave-pending", message: "No question selected." };
    return callSidecar(projectId, "S7_local_geary", body);
  },
  S8_bivariate: async (projectId, settings) => {
    const body = await buildS8Input(projectId, settings);
    if (!body) return { reason: "wave-pending", message: "Two questions required." };
    return callSidecar(projectId, "S8_bivariate", body);
  },
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; cardId: string }> },
) {
  const { projectId, cardId } = await params;

  const url = new URL(req.url);
  const settings: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { settings[k] = v; });

  const handler = POSTGRES_DISPATCH[cardId] ?? SIDECAR_DISPATCH[cardId];
  if (!handler) {
    return NextResponse.json({ error: "unknown card" }, { status: 404 });
  }

  try {
    const data = await handler(projectId, settings);
    return NextResponse.json({ data, computedAt: new Date().toISOString() });
  } catch (err) {
    // Sanitize errors before surfacing to the client. RLS / RPC errors leak
    // internal function names and Postgres error codes when forwarded raw.
    const raw = err instanceof Error ? err.message : "";
    const rawLow = raw.toLowerCase();
    const isPermission = rawLow.includes("permission denied") || rawLow.includes("rls") || rawLow.includes("policy");
    const isAuth = rawLow.includes("auth") || rawLow.includes("not authenticated");
    if (isPermission || isAuth) {
      return NextResponse.json({ error: "forbidden", cardId }, { status: 403 });
    }
    // Generic 500 — do not leak the raw message; log server-side for ops.
    console.error(`[analyses/${cardId}] handler error:`, raw);
    return NextResponse.json({ error: "card_failed", cardId }, { status: 500 });
  }
}
