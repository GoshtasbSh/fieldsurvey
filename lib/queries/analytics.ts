import { createServerSupabase } from "@/lib/supabase/server";

export type DailyBucket = { day: string; total: number };
export type HourBucket = { hour: number; total: number };
export type DowBucket = { dow: number; total: number };
export type SurveyorRow = { collector_id: string | null; name: string; count: number };
export type CoverageMetrics = {
  match_rate_pct: number;
  median_accuracy_m: number | null;
  photo_coverage_pct: number;
  density_per_km2: number | null;
};

/** Returns counts per day for the past 14 days. */
export async function getDailyActivity(projectId: string, days = 14): Promise<DailyBucket[]> {
  const sb = await createServerSupabase();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("points") as any)
    .select("collected_at")
    .eq("project_id", projectId)
    .gte("collected_at", since) as { data: Array<{ collected_at: string }> | null };
  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    buckets.set(d, 0);
  }
  for (const r of data ?? []) {
    const d = r.collected_at.slice(0, 10);
    if (buckets.has(d)) buckets.set(d, (buckets.get(d) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([day, total]) => ({ day, total })).reverse();
}

/** Per-surveyor counts joined with display name. */
export async function getSurveyorLeaderboard(projectId: string): Promise<SurveyorRow[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("points") as any)
    .select("collector_id, profiles!points_collector_id_fkey(display_name, email)")
    .eq("project_id", projectId) as { data: Array<{ collector_id: string | null; profiles: { display_name: string | null; email: string } | null }> | null };
  const counts = new Map<string, { name: string; count: number; collector_id: string | null }>();
  for (const r of data ?? []) {
    const key = r.collector_id ?? "unknown";
    const name = r.profiles?.display_name || r.profiles?.email?.split("@")[0] || "Unknown";
    const cur = counts.get(key) ?? { name, count: 0, collector_id: r.collector_id };
    cur.count += 1;
    counts.set(key, cur);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/** Coverage metrics — generalizable for any spatial survey. */
export async function getCoverageMetrics(projectId: string): Promise<CoverageMetrics> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const [{ data: pts }, { data: rsp }, { data: photos }] = await Promise.all([
    sbAny.from("points").select("id, lat, lon, accuracy_m, matched_response_id").eq("project_id", projectId) as Promise<{ data: Array<{ id: string; lat: number; lon: number; accuracy_m: number | null; matched_response_id: string | null }> | null }>,
    sbAny.from("survey_responses").select("id, point_id").eq("project_id", projectId) as Promise<{ data: Array<{ id: string; point_id: string | null }> | null }>,
    sbAny.from("point_photos").select("point_id").in("point_id", ((await sbAny.from("points").select("id").eq("project_id", projectId)).data ?? []).map((p: { id: string }) => p.id)) as Promise<{ data: Array<{ point_id: string }> | null }>,
  ]);

  const pointsArr = pts ?? [];
  const responsesArr = rsp ?? [];
  const matched = responsesArr.filter((r) => r.point_id).length;
  const match_rate_pct = responsesArr.length > 0 ? Math.round((matched / responsesArr.length) * 100) : 0;

  const accs = pointsArr.map((p) => p.accuracy_m).filter((x): x is number => x != null).sort((a, b) => a - b);
  const median_accuracy_m = accs.length ? accs[Math.floor(accs.length / 2)] : null;

  const pointsWithPhotos = new Set((photos ?? []).map((p) => p.point_id));
  const photo_coverage_pct = pointsArr.length > 0 ? Math.round((pointsWithPhotos.size / pointsArr.length) * 100) : 0;

  // Approximate density: bounding-box area in km^2
  let density_per_km2: number | null = null;
  if (pointsArr.length >= 2) {
    const lats = pointsArr.map((p) => p.lat);
    const lons = pointsArr.map((p) => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const latKm = (maxLat - minLat) * 111;
    const lonKm = (maxLon - minLon) * 111 * Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
    const km2 = Math.max(latKm * lonKm, 0.01);
    density_per_km2 = Math.round(pointsArr.length / km2);
  }

  return { match_rate_pct, median_accuracy_m, photo_coverage_pct, density_per_km2 };
}

/** Count points by hour of day in the project's local timezone. Returns 24 buckets, 0–23. */
export async function getHourlyDistribution(projectId: string, tz = "UTC"): Promise<HourBucket[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("points") as any)
    .select("collected_at")
    .eq("project_id", projectId) as { data: Array<{ collected_at: string }> | null };
  const counts = new Array(24).fill(0) as number[];
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false });
  for (const r of data ?? []) {
    const hStr = fmt.format(new Date(r.collected_at));
    const h = parseInt(hStr, 10);
    if (Number.isFinite(h) && h >= 0 && h < 24) counts[h]++;
  }
  return counts.map((total, hour) => ({ hour, total }));
}

export type DowHourCell = { dow: number; hour: number; count: number };
/** Count points by (day-of-week × hour) in the project's local timezone. Returns 7×24 cells. */
export async function getDowHourMatrix(projectId: string, tz = "UTC"): Promise<DowHourCell[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("points") as any)
    .select("collected_at")
    .eq("project_id", projectId) as { data: Array<{ collected_at: string }> | null };
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hour12: false });
  const wkMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  for (const r of data ?? []) {
    const parts = fmt.formatToParts(new Date(r.collected_at));
    const wk = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const dow = wkMap[wk] ?? 0;
    if (Number.isFinite(h) && h >= 0 && h < 24) grid[dow][h]++;
  }
  return grid.flatMap((row, dow) => row.map((count, hour) => ({ dow, hour, count })));
}

/** Count points by day of week (0=Sun … 6=Sat, UTC). Returns 7 buckets. */
export async function getDayOfWeekDistribution(projectId: string): Promise<DowBucket[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("points") as any)
    .select("collected_at")
    .eq("project_id", projectId) as { data: Array<{ collected_at: string }> | null };
  const counts = new Array(7).fill(0) as number[];
  for (const r of data ?? []) {
    const d = new Date(r.collected_at).getUTCDay();
    counts[d]++;
  }
  return counts.map((total, dow) => ({ dow, total }));
}
