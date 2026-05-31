// Derives a {feature_id → hex} map from a ColorizeSpec + per-row response values.
// Used by the desktop map shell to override feature.color when A0 is active.
//
// Performance: O(n_features) with one upfront break/index computation.

import type { MatchStatusRow } from "@/lib/match/status";
import type { ColorizeSpec, ColumnProfile } from "@/lib/analyses/types";
import {
  resolveBreaks,
  buildCategoricalIndex,
  colorForValue,
} from "./auto-classify";
import {
  continuousRampStops,
  categoricalColors,
  defaultRampFor,
} from "./palettes";

type Args = {
  features: MatchStatusRow[];
  /** Map from response_id → raw value in the selected column. */
  valuesByResponseId: Record<string, unknown>;
  profile: ColumnProfile | null;
  spec: ColorizeSpec | null;
};

/**
 * Returns null when colorize is off — the map then falls back to status colors.
 * F1 features (no response_id) are intentionally NOT colored — preserves the
 * existing yellow + scanline glyph semantics for "field-only, no response".
 */
export function deriveFeatureColors({
  features,
  valuesByResponseId,
  profile,
  spec,
}: Args): Record<string, string> | null {
  if (!spec || !profile) return null;

  const ramp = spec.ramp ?? defaultRampFor(spec.inferredType);
  const isNumeric =
    spec.inferredType === "numeric_continuous" ||
    spec.inferredType === "numeric_skewed" ||
    spec.inferredType === "date";
  const isCategorical = spec.inferredType === "categorical" || spec.inferredType === "boolean";
  const isLikert = spec.inferredType === "likert";

  // Pre-compute ramp stops + breaks once
  let precomputedRampStops: string[] = [];
  let breaks: number[] | undefined;
  let catIndex: Map<string, number> | undefined;

  if (isNumeric) {
    const nums = Object.values(valuesByResponseId)
      .map((v) =>
        spec.inferredType === "date"
          ? Date.parse(String(v))
          : Number(v),
      )
      .filter((n) => Number.isFinite(n));
    breaks = resolveBreaks(nums, spec.classification, spec.classCount, spec.manualBreaks);
    precomputedRampStops = continuousRampStops(ramp, spec.classCount, spec.reversed);
  } else if (isLikert) {
    const k = profile.likertOrder?.length ?? spec.classCount;
    precomputedRampStops = continuousRampStops(ramp, k, spec.reversed);
  } else if (isCategorical) {
    catIndex = buildCategoricalIndex(profile.sampleValues);
    precomputedRampStops = categoricalColors(ramp, profile.sampleValues.length);
  }

  const out: Record<string, string> = {};

  for (const f of features) {
    // F1 (field-only, no response) — leave to status-color fallback (yellow + scanline).
    if (!f.response_id) continue;

    const value = valuesByResponseId[f.response_id];
    const color = colorForValue(
      value,
      spec,
      profile,
      breaks,
      catIndex,
      precomputedRampStops,
    );

    // Key by point_id (preferred) for M1 rows, else response_id for R1.
    const id = f.point_id ?? f.response_id;
    out[id] = color;
  }

  return out;
}
