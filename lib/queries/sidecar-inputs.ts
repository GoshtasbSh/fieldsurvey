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
