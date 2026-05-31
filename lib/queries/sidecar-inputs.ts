import { createServerSupabase } from "@/lib/supabase/server";
import { inferType } from "@/lib/colorize/auto-classify";

/**
 * Server-side helpers that assemble the per-card request body for the Python
 * sidecar. The dispatcher in `/api/projects/[projectId]/analyses/[cardId]`
 * calls these to build the POST body it forwards to FastAPI.
 *
 * Each helper hits the postgres `points` table directly with the service
 * supabase client. Heavy aggregations are kept to small daily-bucketing
 * loops in JS; the heavy stats lives in the sidecar.
 */

export type SpatialCell = { id: string; value: number; lat: number; lon: number };

/**
 * Fetch all M1-matched (field+response) records for a project question column.
 * Returns cells with encoded numeric value. Encoding:
 *   numeric  → as-is
 *   boolean  → 0 / 1
 *   likert   → ordinal rank (0-based, ascending)
 *   categorical → sorted-distinct index (0-based)
 *   missing  → row excluded
 */
export async function buildSpatialCells(
  projectId: string,
  questionKey: string,
  limit = 50_000,
): Promise<SpatialCell[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await ((sb as any)
    .from("points")
    .select("id, lat, lon, survey_responses!matched_response_id(id, raw_data)")
    .eq("project_id", projectId)
    .not("matched_response_id", "is", null)
    .limit(limit)
  ) as { data: Array<{
    id: string; lat: number | null; lon: number | null;
    survey_responses: { id: string; raw_data: Record<string, unknown> | null } | null;
  }> | null };

  if (!data) return [];

  // Collect raw values to infer type once
  const rawAll: unknown[] = [];
  for (const r of data) {
    const v = r.survey_responses?.raw_data?.[questionKey];
    if (v !== null && v !== undefined && v !== "") rawAll.push(v);
  }
  if (rawAll.length === 0) return [];

  const profile = inferType(rawAll);
  const { type, likertOrder, sampleValues } = profile;

  // Build encoding map once
  let encodeMap: Map<string, number> | null = null;
  if (type === "likert" && likertOrder) {
    encodeMap = new Map(likertOrder.map((v, i) => [String(v), i]));
  } else if (type === "categorical" || type === "boolean") {
    const sorted = [...new Set(sampleValues)].sort();
    encodeMap = new Map(sorted.map((v, i) => [String(v), i]));
  }

  const BOOL_TRUE = new Set(["true", "yes", "1", "y"]);

  const cells: SpatialCell[] = [];
  for (const r of data) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const raw = r.survey_responses?.raw_data?.[questionKey];
    if (raw === null || raw === undefined || raw === "") continue;

    let value: number;
    if (type === "numeric_continuous" || type === "numeric_skewed" || type === "date") {
      value = Number(raw);
      if (!Number.isFinite(value)) continue;
    } else if (type === "boolean") {
      value = BOOL_TRUE.has(String(raw).toLowerCase().trim()) ? 1 : 0;
    } else if (encodeMap) {
      const idx = encodeMap.get(String(raw));
      if (idx === undefined) continue;
      value = idx;
    } else {
      continue;
    }

    cells.push({ id: r.id, value, lat: r.lat, lon: r.lon });
  }
  return cells;
}

/** Like buildSpatialCells but encodes 1 if raw === caseValue, else 0. */
export async function buildSpatialCellsBinary(
  projectId: string,
  questionKey: string,
  caseValue: string,
  limit = 50_000,
): Promise<SpatialCell[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await ((sb as any)
    .from("points")
    .select("id, lat, lon, survey_responses!matched_response_id(raw_data)")
    .eq("project_id", projectId)
    .not("matched_response_id", "is", null)
    .limit(limit)
  ) as { data: Array<{
    id: string; lat: number | null; lon: number | null;
    survey_responses: { raw_data: Record<string, unknown> | null } | null;
  }> | null };

  if (!data) return [];
  return data
    .filter((r) => typeof r.lat === "number" && typeof r.lon === "number")
    .map((r) => ({
      id: r.id,
      value: String(r.survey_responses?.raw_data?.[questionKey] ?? "") === caseValue ? 1 : 0,
      lat: r.lat as number,
      lon: r.lon as number,
    }));
}

type CollectedRow = { collected_at: string; lat: number | null; lon: number | null };

async function listPointsLite(projectId: string, limit?: number): Promise<CollectedRow[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (sb.from("points") as any)
    .select("collected_at, lat, lon")
    .eq("project_id", projectId)
    .order("collected_at", { ascending: false });
  if (limit) q = q.limit(limit);
  const { data } = (await q) as { data: CollectedRow[] | null };
  return data ?? [];
}

function bucketDaily(rows: CollectedRow[]): Map<string, number> {
  const days = new Map<string, number>();
  for (const r of rows) {
    if (!r.collected_at) continue;
    const day = r.collected_at.slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  return days;
}

/**
 * A21 finish-date input. Last 30 days of daily counts + target_remaining
 * (universe.total - universe.visited if available; else fall back to a
 * generic remaining estimate of 100). `start` is today.
 */
export async function buildA21FinishInput(
  projectId: string,
): Promise<{ history: number[]; target: number; start: string }> {
  const rows = await listPointsLite(projectId);
  const days = bucketDaily(rows);
  // Build a 30-day window ending today.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const history: number[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    history.push(days.get(key) ?? 0);
  }

  // Target remaining: universe.total - universe.visited, falling back to 100.
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const [allRes, visRes] = await Promise.all([
    sbAny
      .from("survey_universe")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    sbAny
      .from("survey_universe")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "visited"),
  ]);
  const total = (allRes.count as number | null) ?? 0;
  const visited = (visRes.count as number | null) ?? 0;
  const target = Math.max(0, total - visited) || 100;

  return {
    history,
    target,
    start: today.toISOString().slice(0, 10),
  };
}

/**
 * A25 velocity input. Daily counts from project start (= earliest point) to
 * today, zero-filled.
 */
export async function buildA25VelocityInput(
  projectId: string,
): Promise<{ daily_counts: number[] }> {
  const rows = await listPointsLite(projectId);
  if (rows.length === 0) return { daily_counts: [] };

  const days = bucketDaily(rows);
  const sorted = [...days.keys()].sort();
  const startKey = sorted[0];
  const startD = new Date(`${startKey}T00:00:00Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const daily_counts: number[] = [];
  for (let d = startD.getTime(); d <= today.getTime(); d += 86_400_000) {
    const key = new Date(d).toISOString().slice(0, 10);
    daily_counts.push(days.get(key) ?? 0);
  }
  return { daily_counts };
}

/**
 * A11 KDE input. Up to 5000 most recent points with valid lat/lon, formatted
 * as [lon, lat] pairs (the sidecar consumes [lon, lat]).
 */
export async function buildA11KdeInput(
  projectId: string,
): Promise<{ points: [number, number][]; bandwidth: number; grid_size: number }> {
  const rows = await listPointsLite(projectId, 5000);
  const pts = rows
    .filter((r): r is { collected_at: string; lat: number; lon: number } =>
      typeof r.lat === "number" && typeof r.lon === "number",
    )
    .map((r) => [r.lon, r.lat] as [number, number]);
  return { points: pts, bandwidth: 0.005, grid_size: 64 };
}

/**
 * A8 Gi* input. Aggregates points per parcel into cells of {id, value, lat, lon}.
 * For M7 wave-1, the cell `value` is just the point count.
 */
export async function buildA8GiStarInput(
  projectId: string,
): Promise<{ cells: { id: string; value: number; lat: number; lon: number }[]; k: number }> {
  const sb = await createServerSupabase();
  // Cap raw fetch at 50k points — keeps cold reads bounded on large projects.
  // The 250m binning below collapses density anyway, so further raw points
  // contribute marginal cell-value precision but linear memory cost.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await ((sb.from("points") as any)
    .select("lat, lon")
    .eq("project_id", projectId)
    .limit(50000)) as { data: Array<{ lat: number | null; lon: number | null }> | null };

  // Quick-and-cheap binning to ~250m cells (≈0.0025deg lat at FL) to keep the
  // KNN graph tractable. The sidecar does the actual spatial stats; this just
  // pre-aggregates so we never ship 50k raw points across the wire.
  const bin = 0.0025;
  const cellMap = new Map<string, { sumLat: number; sumLon: number; n: number }>();
  for (const r of data ?? []) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const bx = Math.floor(r.lon / bin);
    const by = Math.floor(r.lat / bin);
    const id = `${bx}_${by}`;
    const cur = cellMap.get(id);
    if (cur) {
      cur.sumLat += r.lat;
      cur.sumLon += r.lon;
      cur.n += 1;
    } else {
      cellMap.set(id, { sumLat: r.lat, sumLon: r.lon, n: 1 });
    }
  }
  const cells = [...cellMap.entries()].map(([id, v]) => ({
    id,
    value: v.n,
    lat: v.sumLat / v.n,
    lon: v.sumLon / v.n,
  }));
  return { cells, k: 5 };
}

// ── S-series spatial analysis builders ──────────────────────────────────────

/** S1: Global Moran's I + Geary's C */
export async function buildS1Input(projectId: string, settings: Record<string, string>) {
  const qk = settings["questionKey"] ?? settings["questionkey"] ?? "";
  if (!qk) return null;
  const cells = await buildSpatialCells(projectId, qk);
  return {
    cells,
    weights_type: settings["weightsType"] ?? "knn8",
    n_permutations: Number(settings["nPermutations"] ?? 999),
  };
}

/** S2: Gi* on question column */
export async function buildS2Input(projectId: string, settings: Record<string, string>) {
  const qk = settings["questionKey"] ?? settings["questionkey"] ?? "";
  if (!qk) return null;
  const cells = await buildSpatialCells(projectId, qk);
  return {
    cells,
    weights_type: settings["weightsType"] ?? "knn8",
    fdr_alpha: Number(settings["fdrAlpha"] ?? 0.05),
    n_permutations: Number(settings["nPermutations"] ?? 999),
  };
}

/** S3: LISA Local Moran */
export async function buildS3Input(projectId: string, settings: Record<string, string>) {
  const qk = settings["questionKey"] ?? settings["questionkey"] ?? "";
  if (!qk) return null;
  const cells = await buildSpatialCells(projectId, qk);
  return {
    cells,
    weights_type: settings["weightsType"] ?? "knn8",
    fdr_alpha: Number(settings["fdrAlpha"] ?? 0.05),
    n_permutations: Number(settings["nPermutations"] ?? 999),
  };
}

/** S4: Bernoulli scan — value is 0/1 (answer matches answerOption) */
export async function buildS4Input(projectId: string, settings: Record<string, string>) {
  const qk = settings["questionKey"] ?? settings["questionkey"] ?? "";
  const answerOption = settings["answerOption"] ?? "";
  if (!qk) return null;
  const cells = await buildSpatialCellsBinary(projectId, qk, answerOption);
  return {
    cells,
    max_window_pct: Number(settings["maxWindowPct"] ?? 0.25),
    n_permutations: Number(settings["nPermutations"] ?? 999),
  };
}

/** S5: Distance-decay vs POI */
export async function buildS5Input(projectId: string, settings: Record<string, string>) {
  const qk = settings["questionKey"] ?? settings["questionkey"] ?? "";
  const poiRaw = settings["poi"];
  if (!qk || !poiRaw) return null;
  let poi: { lat: number; lon: number } | null = null;
  try { poi = JSON.parse(poiRaw); } catch { return null; }
  if (!poi) return null;
  const cells = await buildSpatialCells(projectId, qk);
  return {
    cells,
    poi_lat: poi.lat,
    poi_lon: poi.lon,
    n_permutations: Number(settings["nPermutations"] ?? 999),
  };
}

/** S7: Local Geary */
export async function buildS7Input(projectId: string, settings: Record<string, string>) {
  const qk = settings["questionKey"] ?? settings["questionkey"] ?? "";
  if (!qk) return null;
  const cells = await buildSpatialCells(projectId, qk);
  return {
    cells,
    weights_type: settings["weightsType"] ?? "knn8",
    fdr_alpha: Number(settings["fdrAlpha"] ?? 0.05),
    n_permutations: Number(settings["nPermutations"] ?? 999),
    winsorize: settings["winsorize"] !== "false",
  };
}

/** S8: Bivariate Lee's L */
export async function buildS8Input(projectId: string, settings: Record<string, string>) {
  const qkx = settings["questionKeyX"] ?? "";
  const qky = settings["questionKeyY"] ?? "";
  if (!qkx || !qky) return null;
  const [cells_x, cells_y] = await Promise.all([
    buildSpatialCells(projectId, qkx),
    buildSpatialCells(projectId, qky),
  ]);
  return {
    cells_x,
    cells_y,
    fdr_alpha: Number(settings["fdrAlpha"] ?? 0.05),
    n_permutations: Number(settings["nPermutations"] ?? 999),
  };
}

/** A6: Text n-grams — fetch raw text values for a question column */
export async function buildA6Input(projectId: string, settings: Record<string, string>) {
  const qk = settings["questionKey"] ?? settings["questionkey"] ?? "";
  if (!qk) return null;
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).from("survey_responses")
    .select("raw_data").eq("project_id", projectId) as
    { data: Array<{ raw_data: Record<string, unknown> | null }> | null };
  const texts = (data ?? []).map(r => String(r.raw_data?.[qk] ?? ""));
  return { texts, n_gram: settings["nGram"] ?? "both", max_terms: Number(settings["maxTerms"] ?? 20) };
}

/** A35: Straight-line detector — fetch all numeric/Likert values */
export async function buildA35Input(projectId: string, settings: Record<string, string>) {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).from("survey_responses")
    .select("id, raw_data").eq("project_id", projectId) as
    { data: Array<{ id: string; raw_data: Record<string, unknown> | null }> | null };
  if (!data || data.length === 0) return null;
  const sample = data.find(r => r.raw_data)?.raw_data ?? {};
  const numericKeys = Object.keys(sample).filter(k => {
    const vals = data.map(r => r.raw_data?.[k]).filter(v => v !== null && v !== undefined && v !== "");
    return vals.length >= 3 && vals.every(v => Number.isFinite(Number(v)));
  });
  const minQuestions = Number(settings["minQuestions"] ?? 3);
  if (numericKeys.length < minQuestions) return null;
  const rows = data.map(r => ({
    response_id: r.id,
    values: numericKeys.map(k => {
      const v = r.raw_data?.[k];
      return (v !== null && v !== undefined && v !== "") ? Number(v) : null;
    }),
  }));
  return { rows, question_keys: numericKeys, threshold: Number(settings["threshold"] ?? 0.8), min_questions: minQuestions };
}

/** A43: Raking diagnostic — fetch group values for one question */
export async function buildA43Input(projectId: string, settings: Record<string, string>) {
  const groupKey = settings["groupKey"] ?? settings["groupkey"] ?? "";
  if (!groupKey) return null;
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).from("survey_responses")
    .select("raw_data").eq("project_id", projectId) as
    { data: Array<{ raw_data: Record<string, unknown> | null }> | null };
  const groupValues = (data ?? []).map(r => String(r.raw_data?.[groupKey] ?? "")).filter(Boolean);
  if (groupValues.length === 0) return null;
  return { group_values: groupValues, trim_cap: Number(settings["trimCap"] ?? 5) };
}

/** A46: Segment diff — fetch all responses with group + question values */
export async function buildA46Input(projectId: string, settings: Record<string, string>) {
  const groupKey = settings["groupKey"] ?? settings["groupkey"] ?? "";
  if (!groupKey) return null;
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).from("survey_responses")
    .select("id, raw_data").eq("project_id", projectId) as
    { data: Array<{ id: string; raw_data: Record<string, unknown> | null }> | null };
  if (!data) return null;
  const rows = data
    .filter(r => r.raw_data?.[groupKey])
    .map(r => ({
      response_id: r.id,
      group_value: String(r.raw_data![groupKey]),
      question_values: Object.fromEntries(Object.entries(r.raw_data ?? {}).filter(([k]) => k !== groupKey)),
    }));
  if (rows.length === 0) return null;
  return { rows, group_key: groupKey, fdr_alpha: Number(settings["fdrAlpha"] ?? 0.05), min_n: Number(settings["minN"] ?? 10) };
}

// ── V2 input builders ────────────────────────────────────────────────────────

/**
 * V2 Emerging Hot Spot — fetch M1 points with timestamps and encoded value.
 * Returns one row per matched point including the ISO-8601 created_at from
 * the underlying survey_response.
 */
export async function buildV2SpaceTimeInput(projectId: string, settings: Record<string, string>) {
  const qk = settings["questionKey"] ?? settings["questionkey"] ?? "";
  if (!qk || qk === "inherit_global") return null;
  const timeBucket = settings["timeBucket"] ?? "week";

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any)
    .from("points")
    .select("id, lat, lon, survey_responses!matched_response_id(id, raw_data, created_at)")
    .eq("project_id", projectId)
    .not("matched_response_id", "is", null)
    .limit(50_000) as {
      data: Array<{
        id: string; lat: number | null; lon: number | null;
        survey_responses: { id: string; raw_data: Record<string, unknown> | null; created_at: string | null } | null;
      }> | null;
    };

  if (!data || data.length === 0) return null;

  // Collect raw values to infer type
  const rawAll: unknown[] = [];
  for (const r of data) {
    const v = r.survey_responses?.raw_data?.[qk];
    if (v !== null && v !== undefined && v !== "") rawAll.push(v);
  }
  if (rawAll.length === 0) return null;

  const { inferType } = await import("@/lib/colorize/auto-classify");
  const profile = inferType(rawAll);
  const { type, likertOrder, sampleValues } = profile;
  let encodeMap: Map<string, number> | null = null;
  if (type === "likert" && likertOrder) {
    encodeMap = new Map(likertOrder.map((v, i) => [String(v), i]));
  } else if (type === "categorical" || type === "boolean") {
    const sorted = [...new Set(sampleValues)].sort();
    encodeMap = new Map(sorted.map((v, i) => [String(v), i]));
  }
  const BOOL_TRUE = new Set(["true", "yes", "1", "y"]);

  const rows: { id: string; lat: number; lon: number; value: number; created_at: string }[] = [];
  for (const r of data) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const createdAt = r.survey_responses?.created_at;
    if (!createdAt) continue;
    const raw = r.survey_responses?.raw_data?.[qk];
    if (raw === null || raw === undefined || raw === "") continue;

    let value: number;
    if (type === "numeric_continuous" || type === "numeric_skewed" || type === "date") {
      value = Number(raw);
      if (!Number.isFinite(value)) continue;
    } else if (type === "boolean") {
      value = BOOL_TRUE.has(String(raw).toLowerCase().trim()) ? 1 : 0;
    } else if (encodeMap) {
      const idx = encodeMap.get(String(raw));
      if (idx === undefined) continue;
      value = idx;
    } else {
      continue;
    }
    rows.push({ id: r.id, lat: r.lat, lon: r.lon, value, created_at: createdAt });
  }

  if (rows.length < 10) return null;
  return {
    project_id: projectId,
    rows,
    time_bucket: timeBucket,
    n_permutations: Number(settings["nPermutations"] ?? 99),
  };
}

/**
 * V2 Spatial Regression — build multi-variate cells (y + x keys, all encoded).
 * Returns cells with a `values` map: { [questionKey]: encodedNumber }.
 */
export async function buildV2SpatialRegInput(projectId: string, settings: Record<string, string>) {
  const yKey = settings["yKey"] ?? settings["ykey"] ?? "";
  const xKey = settings["xKey"] ?? settings["xkey"] ?? "";
  if (!yKey || !xKey || yKey === "inherit_global" || xKey === "inherit_global") return null;
  const allKeys = [yKey, xKey];

  // Fetch spatial cells for each key independently, then join by point id
  const [yCells, xCells] = await Promise.all([
    buildSpatialCells(projectId, yKey),
    buildSpatialCells(projectId, xKey),
  ]);
  if (yCells.length < 30 || xCells.length < 30) return null;

  const xMap = new Map(xCells.map(c => [c.id, c.value]));
  const cells: Array<{ id: string; lat: number; lon: number; values: Record<string, number | null> }> = [];
  for (const yc of yCells) {
    const xv = xMap.get(yc.id);
    if (xv === undefined) continue;
    cells.push({ id: yc.id, lat: yc.lat, lon: yc.lon, values: { [yKey]: yc.value, [xKey]: xv } });
  }
  if (cells.length < 30) return null;

  return {
    project_id: projectId,
    cells,
    y_key: yKey,
    x_keys: [xKey],
    weights_type: settings["weightsType"] ?? "knn8",
    n_permutations: Number(settings["nPermutations"] ?? 499),
  };
}

/**
 * V2 Segregation — fetch geocoded responses with the group-label question value.
 * Returns rows with {id, lat, lon, group_value}.
 */
export async function buildV2SegregationInput(projectId: string, settings: Record<string, string>) {
  const groupKey = settings["groupKey"] ?? settings["groupkey"] ?? "";
  if (!groupKey || groupKey === "inherit_global") return null;
  const zoneSizeDeg = parseFloat(settings["zoneSizeDeg"] ?? "0.1");

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any)
    .from("points")
    .select("id, lat, lon, survey_responses!matched_response_id(raw_data)")
    .eq("project_id", projectId)
    .not("matched_response_id", "is", null)
    .limit(50_000) as {
      data: Array<{
        id: string; lat: number | null; lon: number | null;
        survey_responses: { raw_data: Record<string, unknown> | null } | null;
      }> | null;
    };

  if (!data || data.length === 0) return null;

  const rows = data
    .filter(r => typeof r.lat === "number" && typeof r.lon === "number")
    .map(r => ({
      id: r.id,
      lat: r.lat as number,
      lon: r.lon as number,
      group_value: r.survey_responses?.raw_data?.[groupKey] != null
        ? String(r.survey_responses.raw_data[groupKey])
        : null,
    }))
    .filter(r => r.group_value !== null && r.group_value !== "");

  if (rows.length < 20) return null;
  return { project_id: projectId, rows, zone_size_deg: zoneSizeDeg };
}
