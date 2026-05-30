// Auto-classify: pure functions for the A0 question colorizer.
// Infers column type, computes class breaks (quantile / equal-interval / Jenks),
// resolves a color for any single value given a ColorizeSpec + ColumnProfile.

import type {
  ColorizeSpec,
  ColumnProfile,
  InferredColumnType,
  ClassificationMethod,
} from "@/lib/analyses/types";
import {
  continuousRampStops,
  categoricalColors,
  defaultRampFor,
  MISSING_COLOR,
} from "./palettes";

// ── Type inference ──────────────────────────────────────────────────────────

const LIKERT_VOCAB: string[][] = [
  ["strongly disagree", "disagree", "neutral", "agree", "strongly agree"],
  ["strongly agree", "agree", "neutral", "disagree", "strongly disagree"],
  ["very poor", "poor", "fair", "good", "very good"],
  ["never", "rarely", "sometimes", "often", "always"],
  ["not at all", "slightly", "moderately", "very", "extremely"],
  ["1", "2", "3", "4", "5"],
  ["1", "2", "3", "4", "5", "6", "7"],
];

/** Cheap normalize for matching Likert vocabs. */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[._-]/g, " ").replace(/\s+/g, " ");
}

/** Try to detect a Likert ordering for a small distinct-value set. */
export function detectLikert(values: string[]): string[] | null {
  const set = new Set(values.map(norm));
  for (const vocab of LIKERT_VOCAB) {
    if (vocab.every((v) => set.has(v)) && set.size === vocab.length) {
      // Return original casing from values, ordered by vocab
      return vocab.map((v) => values.find((x) => norm(x) === v) ?? v);
    }
  }
  return null;
}

/** Infer a column type from a sample of string values. */
export function inferType(rawValues: Array<unknown>): {
  type: InferredColumnType;
  distinct: number;
  nNonNull: number;
  min?: number;
  max?: number;
  median?: number;
  skewness?: number;
  likertOrder?: string[];
  sampleValues: string[];
} {
  const nonNull = rawValues.filter((v) => v !== null && v !== undefined && v !== "");
  if (nonNull.length === 0) {
    return { type: "missing", distinct: 0, nNonNull: 0, sampleValues: [] };
  }
  const distinctSet = new Set<string>(nonNull.map((v) => String(v)));
  const distinct = distinctSet.size;
  const distinctArr = [...distinctSet];

  // Date? ISO date heuristic
  if (distinct >= 10 && nonNull.every((v) => !Number.isNaN(Date.parse(String(v))) && /\d{4}-\d{2}-\d{2}/.test(String(v)))) {
    return { type: "date", distinct, nNonNull: nonNull.length, sampleValues: distinctArr.slice(0, 12) };
  }

  // Boolean?
  if (distinct === 2) {
    const norms = new Set([...distinctSet].map(norm));
    const boolish = new Set(["true", "false", "yes", "no", "0", "1", "y", "n"]);
    let bool = true;
    for (const v of norms) if (!boolish.has(v)) { bool = false; break; }
    if (bool) {
      return { type: "boolean", distinct, nNonNull: nonNull.length, sampleValues: distinctArr };
    }
  }

  // Numeric?
  const nums: number[] = [];
  let allNumeric = true;
  for (const v of nonNull) {
    const n = Number(v);
    if (!Number.isFinite(n) || String(v).trim() === "") { allNumeric = false; break; }
    nums.push(n);
  }
  if (allNumeric && nums.length >= 10) {
    const sorted = [...nums].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
    const std = Math.sqrt(variance);
    const skewness = std > 0
      ? nums.reduce((a, b) => a + ((b - mean) / std) ** 3, 0) / nums.length
      : 0;
    const type: InferredColumnType = Math.abs(skewness) >= 2 ? "numeric_skewed" : "numeric_continuous";
    return {
      type, distinct, nNonNull: nonNull.length,
      min, max, median, skewness,
      sampleValues: distinctArr.slice(0, 12),
    };
  }

  // Likert?
  if (distinct >= 3 && distinct <= 7) {
    const likertOrder = detectLikert(distinctArr);
    if (likertOrder) {
      return { type: "likert", distinct, nNonNull: nonNull.length, likertOrder, sampleValues: distinctArr };
    }
  }

  // Categorical small vocab
  if (distinct <= 12) {
    return { type: "categorical", distinct, nNonNull: nonNull.length, sampleValues: distinctArr };
  }

  // Text — long avg length or high-distinct
  const avgLen = nonNull.reduce((acc: number, v) => acc + String(v).length, 0) / nonNull.length;
  if (avgLen > 50 || distinct / nonNull.length > 0.4) {
    return { type: "text_open", distinct, nNonNull: nonNull.length, sampleValues: distinctArr.slice(0, 6) };
  }

  return { type: "categorical", distinct, nNonNull: nonNull.length, sampleValues: distinctArr.slice(0, 12) };
}

/** Build a ColumnProfile from raw values — used at import time + ad-hoc. */
export function buildColumnProfile(key: string, rawValues: unknown[]): ColumnProfile {
  const r = inferType(rawValues);
  return {
    key,
    inferredType: r.type,
    nNonNull: r.nNonNull,
    distinct: r.distinct,
    min: r.min,
    max: r.max,
    median: r.median,
    skewness: r.skewness,
    sampleValues: r.sampleValues,
    likertOrder: r.likertOrder,
  };
}

// ── Class break calculation ──────────────────────────────────────────────────

/** Quantile breaks: equal-count classes. */
export function quantileBreaks(values: number[], k: number): number[] {
  if (values.length < k) return values.slice().sort((a, b) => a - b);
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 1; i < k; i++) {
    const idx = Math.floor((i * sorted.length) / k);
    out.push(sorted[idx]);
  }
  return out;
}

/** Equal-interval breaks. */
export function equalIntervalBreaks(min: number, max: number, k: number): number[] {
  const out: number[] = [];
  const step = (max - min) / k;
  for (let i = 1; i < k; i++) out.push(min + step * i);
  return out;
}

/** Jenks natural breaks — Fisher-Jenks O(N²k) on small N; cap for safety. */
export function jenksBreaks(values: number[], k: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n <= k) {
    // With fewer than k sample points, the algorithm can't pick k-1 interior
    // breaks. Use the unique sample values themselves so callers never see
    // NaN/undefined entries — bin counts simply collapse for sparse columns.
    const unique = [...new Set(sorted)].sort((a, b) => a - b);
    return unique.slice(0, Math.min(unique.length - 1, k - 1));
  }
  // For large arrays, downsample to a representative 500-point grid to keep cost bounded
  const sample = n > 500
    ? Array.from({ length: 500 }, (_, i) => sorted[Math.floor((i * n) / 500)])
    : sorted;
  const m = sample.length;
  const lc: number[][] = Array.from({ length: m + 1 }, () => Array(k + 1).fill(0));
  const ov: number[][] = Array.from({ length: m + 1 }, () => Array(k + 1).fill(Number.POSITIVE_INFINITY));
  for (let j = 1; j <= k; j++) {
    lc[1][j] = 1;
    ov[1][j] = 0;
    for (let i = 2; i <= m; i++) ov[i][j] = Number.POSITIVE_INFINITY;
  }
  let v = 0.0;
  for (let l = 2; l <= m; l++) {
    let s1 = 0.0, s2 = 0.0, w = 0;
    for (let mm = 1; mm <= l; mm++) {
      const i3 = l - mm + 1;
      const val = sample[i3 - 1];
      s2 += val * val;
      s1 += val;
      w++;
      v = s2 - (s1 * s1) / w;
      const i4 = i3 - 1;
      if (i4 !== 0) {
        for (let j = 2; j <= k; j++) {
          if (ov[l][j] >= v + ov[i4][j - 1]) {
            lc[l][j] = i3;
            ov[l][j] = v + ov[i4][j - 1];
          }
        }
      }
    }
    lc[l][1] = 1;
    ov[l][1] = v;
  }
  const breaks: number[] = [];
  let kIdx = k, end = m;
  while (kIdx > 1) {
    const start = lc[end][kIdx];
    breaks.unshift(sample[start - 1]);
    end = start - 1;
    kIdx--;
  }
  return breaks.slice(0, k - 1);
}

/** Resolve class breaks per the ColorizeSpec. Returns sorted ascending breaks. */
export function resolveBreaks(
  values: number[],
  method: ClassificationMethod,
  k: number,
  manualBreaks?: number[],
): number[] {
  if (method === "manual" && manualBreaks && manualBreaks.length === k - 1) {
    return [...manualBreaks].sort((a, b) => a - b);
  }
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length === 0) return [];
  if (method === "equal_interval") {
    const min = Math.min(...nums), max = Math.max(...nums);
    return equalIntervalBreaks(min, max, k);
  }
  if (method === "natural_breaks") {
    try { return jenksBreaks(nums, k); } catch { return quantileBreaks(nums, k); }
  }
  return quantileBreaks(nums, k);
}

// ── Color resolution for an individual point ────────────────────────────────

/** Given a single response value + spec + profile, return the hex color (or null = missing). */
export function colorForValue(
  value: unknown,
  spec: ColorizeSpec,
  profile: ColumnProfile,
  breaks?: number[],
  categoricalIndexMap?: Map<string, number>,
  precomputedRampStops?: string[],
): string {
  if (value === null || value === undefined || value === "") return MISSING_COLOR;

  const ramp = spec.ramp ?? defaultRampFor(spec.inferredType);

  if (spec.inferredType === "categorical" || spec.inferredType === "boolean") {
    const idx = categoricalIndexMap?.get(String(value)) ?? 0;
    const colors = precomputedRampStops ?? categoricalColors(ramp, profile.distinct || 1);
    return colors[idx % colors.length];
  }

  if (spec.inferredType === "likert") {
    const order = profile.likertOrder ?? [];
    const idx = order.indexOf(String(value));
    const k = order.length || spec.classCount;
    const colors = precomputedRampStops ?? continuousRampStops(ramp, k, spec.reversed);
    return colors[idx < 0 ? Math.floor(k / 2) : idx];
  }

  if (
    spec.inferredType === "numeric_continuous" ||
    spec.inferredType === "numeric_skewed" ||
    spec.inferredType === "date"
  ) {
    const num =
      spec.inferredType === "date"
        ? Date.parse(String(value))
        : Number(value);
    if (!Number.isFinite(num)) return MISSING_COLOR;
    const k = spec.classCount;
    const bks = breaks ?? [];
    const colors = precomputedRampStops ?? continuousRampStops(ramp, k, spec.reversed);
    // bin index
    let bin = 0;
    for (const b of bks) {
      if (num <= b) break;
      bin++;
    }
    return colors[Math.min(bin, colors.length - 1)];
  }

  return MISSING_COLOR;
}

/** Build categorical-value → palette-index map, deterministic by sort order. */
export function buildCategoricalIndex(distinctValues: string[]): Map<string, number> {
  const m = new Map<string, number>();
  [...distinctValues].sort().forEach((v, i) => m.set(v, i));
  return m;
}

/** Default ColorizeSpec for a freshly-picked column. */
export function defaultSpecFor(profile: ColumnProfile): ColorizeSpec {
  const ramp = defaultRampFor(profile.inferredType);
  const classCount: 3 | 5 | 7 | 9 = profile.inferredType === "likert"
    ? ((profile.likertOrder?.length === 7 ? 7 : 5) as 5 | 7)
    : 5;
  const classification: ClassificationMethod =
    profile.inferredType === "numeric_skewed" ? "quantile" : "quantile";
  return {
    columnKey: profile.key,
    inferredType: profile.inferredType,
    classification,
    classCount,
    ramp,
    reversed: false,
  };
}
