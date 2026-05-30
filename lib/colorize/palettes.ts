// CB-safe color palettes for the A0 question colorizer.
// Continuous ramps come from matplotlib (sampled at 11 stops).
// Categorical sets are ColorBrewer Set2 / Set3 / Dark2 (CB-safe).

import type { ColorRamp } from "@/lib/analyses/types";

// ── Continuous ramps (11 stops, value 0 → 1) ────────────────────────────────
const VIRIDIS = [
  "#440154", "#482878", "#3e4989", "#31688e", "#26828e",
  "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725", "#fcffa4",
];
const INFERNO = [
  "#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60",
  "#cf4446", "#ed6925", "#fb9a06", "#f7d13d", "#fcffa4", "#ffffff",
];
const PLASMA = [
  "#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786",
  "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921", "#ffffea",
];
const CIVIDIS = [
  "#00224e", "#123570", "#3b496c", "#575c6d", "#707173",
  "#8a8779", "#a59c74", "#c3b369", "#e1cc55", "#fee838", "#ffffe1",
];
const MAGMA = [
  "#000004", "#180f3d", "#440f76", "#721f81", "#9e2f7f",
  "#cd4071", "#f1605d", "#fd9668", "#feca8d", "#fcfdbf", "#ffffff",
];
// Diverging — anchored at neutral midpoint
const RDBU_R = [
  "#053061", "#2166ac", "#4393c3", "#92c5de", "#d1e5f0",
  "#f7f7f7", "#fddbc7", "#f4a582", "#d6604d", "#b2182b", "#67001f",
];
const BRBG = [
  "#543005", "#8c510a", "#bf812d", "#dfc27d", "#f6e8c3",
  "#f5f5f5", "#c7eae5", "#80cdc1", "#35978f", "#01665e", "#003c30",
];

const CONTINUOUS: Record<ColorRamp, string[] | null> = {
  viridis: VIRIDIS,
  inferno: INFERNO,
  plasma: PLASMA,
  cividis: CIVIDIS,
  magma: MAGMA,
  RdBu_r: RDBU_R,
  BrBG: BRBG,
  Set2: null,
  Set3: null,
  Dark2: null,
};

// ── Categorical sets ────────────────────────────────────────────────────────
const SET2 = ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f", "#e5c494", "#b3b3b3"];
const SET3 = [
  "#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462",
  "#b3de69", "#fccde5", "#d9d9d9", "#bc80bd", "#ccebc5", "#ffed6f",
];
const DARK2 = ["#1b9e77", "#d95f02", "#7570b3", "#e7298a", "#66a61e", "#e6ab02", "#a6761d", "#666666"];

const CATEGORICAL: Record<ColorRamp, string[] | null> = {
  Set2: SET2,
  Set3: SET3,
  Dark2: DARK2,
  viridis: null,
  inferno: null,
  plasma: null,
  cividis: null,
  magma: null,
  RdBu_r: null,
  BrBG: null,
};

/** Pick N evenly-spaced colors from a continuous ramp. */
export function continuousRampStops(ramp: ColorRamp, n: number, reversed = false): string[] {
  const stops = CONTINUOUS[ramp];
  if (!stops) return continuousRampStops("viridis", n, reversed);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const idx = Math.round(t * (stops.length - 1));
    out.push(stops[idx]);
  }
  return reversed ? out.reverse() : out;
}

/** Return N categorical colors. Cycles if N exceeds palette size. */
export function categoricalColors(ramp: ColorRamp, n: number): string[] {
  const palette = CATEGORICAL[ramp] ?? CATEGORICAL.Set2!;
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(palette[i % palette.length]);
  return out;
}

/** Pick a default ramp based on inferred column type. */
export function defaultRampFor(inferredType: string): ColorRamp {
  switch (inferredType) {
    case "likert":
      return "RdBu_r";
    case "numeric_continuous":
    case "numeric_skewed":
    case "date":
      return "viridis";
    case "categorical":
    case "boolean":
      return "Set2";
    default:
      return "viridis";
  }
}

/** Color for "missing" / "not applicable" / F1 fallback. */
export const MISSING_COLOR = "#9ca3af"; // gray-400, CVD safe
