import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type UniverseRow = {
  id: string;
  project_id: string;
  address: string;
  lat: number | null;
  lon: number | null;
  status: "not_visited" | "visited" | "skipped";
  visited_at: string | null;
  visited_by: string | null;
  point_id: string | null;
  external_id: string | null;
};

export type UniverseStatus = UniverseRow["status"];

/**
 * Server-side list of universe rows for a project, optionally filtered by
 * status. Member-readable per RLS.
 */
export async function listUniverseRows(
  projectId: string,
  opts: { status?: UniverseStatus; limit?: number; offset?: number } = {},
): Promise<{ rows: UniverseRow[]; total: number }> {
  const sb = await createServerSupabase();
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (sb.from("survey_universe") as any)
    .select(
      "id, project_id, address, lat, lon, status, visited_at, visited_by, point_id, external_id",
      { count: "exact" },
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, count } = (await q) as { data: UniverseRow[] | null; count: number | null };
  return { rows: data ?? [], total: count ?? 0 };
}

/**
 * Universe-completion summary used by the analytics swap. Three counts +
 * percent visited. Member-readable per RLS.
 */
export async function getCanvassCompletion(projectId: string): Promise<{
  total: number;
  visited: number;
  skipped: number;
  pct: number;
}> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const [all, vis, skip] = await Promise.all([
    sbAny
      .from("survey_universe")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    sbAny
      .from("survey_universe")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "visited"),
    sbAny
      .from("survey_universe")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "skipped"),
  ]);
  const total = (all.count as number | null) ?? 0;
  const visited = (vis.count as number | null) ?? 0;
  const skipped = (skip.count as number | null) ?? 0;
  return {
    total,
    visited,
    skipped,
    pct: total > 0 ? visited / total : 0,
  };
}

/**
 * Mark a universe row visited. Used server-side from /api/points after a
 * point insert when canvass_mode is on. Uses admin client because the
 * caller may be a guest (no Supabase user) — the route validates that the
 * row belongs to the same project as the inserted point before calling.
 */
export async function markUniverseVisited(opts: {
  rowId: string;
  pointId: string;
  visitedBy: string | null;
}): Promise<void> {
  const admin = createAdminSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("survey_universe")
    .update({
      status: "visited",
      visited_at: new Date().toISOString(),
      visited_by: opts.visitedBy,
      point_id: opts.pointId,
    })
    .eq("id", opts.rowId)
    .eq("status", "not_visited"); // idempotent — don't clobber already-visited
}

/**
 * Find the nearest not-yet-visited universe row within `radiusM` meters of
 * (lat, lon) for the given project. Returns null if none in range.
 *
 * Pure-Haversine in JS over a candidate set bounded by a bounding-box query
 * on (project_id, status='not_visited'). The candidate set is capped so a
 * project with 100k addresses doesn't slurp the whole table into Node.
 */
export async function findNearestNotVisited(opts: {
  projectId: string;
  lat: number;
  lon: number;
  radiusM: number;
  client?: "user" | "admin";
}): Promise<{ id: string; address: string; distance_m: number } | null> {
  const { projectId, lat, lon, radiusM } = opts;
  const sb = opts.client === "admin" ? createAdminSupabase() : await createServerSupabase();

  // Rough degree-window around the point. 1 deg lat ≈ 111_320 m.
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.000001, Math.cos((lat * Math.PI) / 180)));
  const minLat = lat - dLat;
  const maxLat = lat + dLat;
  const minLon = lon - dLon;
  const maxLon = lon + dLon;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await ((sb as any)
    .from("survey_universe")
    .select("id, address, lat, lon")
    .eq("project_id", projectId)
    .eq("status", "not_visited")
    .not("lat", "is", null)
    .not("lon", "is", null)
    .gte("lat", minLat)
    .lte("lat", maxLat)
    .gte("lon", minLon)
    .lte("lon", maxLon)
    .limit(500)) as { data: Array<{ id: string; address: string; lat: number; lon: number }> | null };

  if (!data?.length) return null;

  let best: { id: string; address: string; distance_m: number } | null = null;
  for (const r of data) {
    const d = haversineMeters(lat, lon, r.lat, r.lon);
    if (d <= radiusM && (!best || d < best.distance_m)) {
      best = { id: r.id, address: r.address, distance_m: d };
    }
  }
  return best;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
