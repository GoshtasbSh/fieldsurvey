/**
 * Dashboard-cache refresh worker.
 *
 * Locked Q1: moderate scope — five blobs per project:
 *   • pulse_blob        — KPI counts, today delta, 14-day daily series
 *   • analyze_blob      — hourly + DOW + surveyor leaderboard + coverage
 *   • match_status_blob — M1/F1/R1 counts
 *   • points_geojson    — full FeatureCollection of project points
 *   • responses_geojson — FeatureCollection of survey_responses (when geocoded)
 *
 * After each refresh, a snapshot is written to analysis_versions and the
 * keep-last-50-plus-daily-rollup prune function runs.
 *
 * Must run with the admin (service-role) Supabase client — the cache and
 * versions tables are write-protected against anon/authenticated.
 */

import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type CacheDataType =
  | "pulse_blob"
  | "analyze_blob"
  | "match_status_blob"
  | "points_geojson"
  | "responses_geojson"
  | "canvass_blob";

export type RefreshTrigger = "auto" | "import" | "cron" | "manual";

export type RefreshResult = {
  ok: true;
  projectId: string;
  trigger: RefreshTrigger;
  blobs: Record<CacheDataType, { bytes: number; rows?: number }>;
  delta: Record<string, number>;
};

export async function refreshProjectCache(
  projectId: string,
  opts: { trigger?: RefreshTrigger; sinceIso?: string } = {},
): Promise<RefreshResult | { ok: false; error: string }> {
  const trigger = opts.trigger ?? "auto";
  const sb = createAdminSupabase();

  // ── 1. Read all the raw data we need in parallel ─────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [pointsRes, responsesRes, statusesRes, matchCountsRes, photosCountRes, todayPointsRes, dailyRes] =
    await Promise.all([
      sbAny
        .from("points")
        .select(
          "id, status_id, lat, lon, accuracy_m, address, collector_id, collected_at, created_at, matched_response_id",
        )
        .eq("project_id", projectId)
        .limit(10_000),
      sbAny
        .from("survey_responses")
        .select("id, project_id, address, lat, lon, status, imported_at, point_id")
        .eq("project_id", projectId)
        .limit(10_000),
      sbAny
        .from("project_statuses")
        .select("id, label, color, icon")
        .eq("project_id", projectId),
      sbAny
        .from("v_match_status_counts")
        .select("m1_count, f1_count, r1_count, total_with_status")
        .eq("project_id", projectId)
        .maybeSingle(),
      sbAny
        .from("point_photos")
        .select("point_id", { count: "exact", head: true }),
      sbAny
        .from("points")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .gte("created_at", since24h),
      sbAny
        .from("points")
        .select("created_at")
        .eq("project_id", projectId)
        .gte("created_at", new Date(Date.now() - 14 * 86400_000).toISOString()),
    ]);

  if (pointsRes.error) return { ok: false, error: `points: ${pointsRes.error.message}` };
  if (responsesRes.error) return { ok: false, error: `responses: ${responsesRes.error.message}` };

  const points: Array<{
    id: string;
    status_id: string | null;
    lat: number;
    lon: number;
    accuracy_m: number | null;
    address: string | null;
    collector_id: string | null;
    collected_at: string | null;
    created_at: string;
    matched_response_id: string | null;
  }> = pointsRes.data ?? [];
  const responses: Array<{
    id: string;
    project_id: string;
    address: string | null;
    lat: number | null;
    lon: number | null;
    status: string | null;
    imported_at: string;
    point_id: string | null;
  }> = responsesRes.data ?? [];
  const statuses: Array<{ id: string; label: string; color: string; icon: string | null }> =
    statusesRes.data ?? [];
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const matchCounts =
    (matchCountsRes.data as {
      m1_count: number;
      f1_count: number;
      r1_count: number;
      total_with_status: number;
    } | null) ?? { m1_count: 0, f1_count: 0, r1_count: 0, total_with_status: 0 };
  const todayDelta = (todayPointsRes.count as number | null) ?? 0;

  // ── 2. Build pulse_blob ─────────────────────────────────────────────
  const dailyByDay = new Map<string, number>();
  for (const p of (dailyRes.data as Array<{ created_at: string }>) ?? []) {
    const day = p.created_at.slice(0, 10);
    dailyByDay.set(day, (dailyByDay.get(day) ?? 0) + 1);
  }
  const daily: Array<{ day: string; total: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    const key = d.toISOString().slice(0, 10);
    daily.push({ day: key, total: dailyByDay.get(key) ?? 0 });
  }
  const pulseBlob = {
    pointsTotal: points.length,
    todayDelta,
    matchCounts,
    daily,
    refreshedAt: new Date().toISOString(),
  };

  // ── 3. Build analyze_blob ───────────────────────────────────────────
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0 }));
  const dow = Array.from({ length: 7 }, (_, d) => ({ dow: d, total: 0 }));
  const surveyorMap = new Map<string | null, { collector_id: string | null; count: number }>();
  let accAccuracies: number[] = [];
  let withPhoto = 0;
  let withLatLon = 0;
  const photosByPoint = new Map<string, number>();
  // (We don't have a join above; do a separate small count if needed.)
  // For density, derive bbox area from points.
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of points) {
    if (p.collected_at) {
      const d = new Date(p.collected_at);
      hourly[d.getUTCHours()].total += 1;
      dow[d.getUTCDay()].total += 1;
    }
    const cur = surveyorMap.get(p.collector_id) ?? { collector_id: p.collector_id, count: 0 };
    cur.count += 1;
    surveyorMap.set(p.collector_id, cur);
    if (typeof p.accuracy_m === "number") accAccuracies.push(p.accuracy_m);
    if (typeof p.lat === "number" && typeof p.lon === "number") {
      withLatLon += 1;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
  }
  for (const p of points) {
    if (photosByPoint.has(p.id)) withPhoto += 1;
  }
  void photosCountRes;
  // Median accuracy
  accAccuracies = accAccuracies.sort((a, b) => a - b);
  const median_accuracy_m =
    accAccuracies.length > 0
      ? accAccuracies[Math.floor(accAccuracies.length / 2)] ?? null
      : null;
  // Density per km² (approximate, equirectangular at midLat)
  let density_per_km2: number | null = null;
  if (Number.isFinite(minLat) && withLatLon >= 2) {
    const midLat = (minLat + maxLat) / 2;
    const widthKm = (maxLon - minLon) * 111.32 * Math.cos((midLat * Math.PI) / 180);
    const heightKm = (maxLat - minLat) * 111.32;
    const areaKm2 = Math.max(0.001, widthKm * heightKm);
    density_per_km2 = Math.round((points.length / areaKm2) * 10) / 10;
  }
  // Surveyor leaderboard
  const surveyors = Array.from(surveyorMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const total = matchCounts.total_with_status + matchCounts.r1_count;
  const match_rate_pct = total > 0 ? Math.round((matchCounts.m1_count / total) * 100) : 0;
  const photo_coverage_pct =
    points.length > 0 ? Math.round((withPhoto / points.length) * 100) : 0;

  const analyzeBlob = {
    matchCounts,
    hourly,
    dow,
    surveyors,
    coverage: {
      match_rate_pct,
      median_accuracy_m,
      photo_coverage_pct,
      density_per_km2,
    },
    refreshedAt: new Date().toISOString(),
  };

  // ── 4. Build match_status_blob ──────────────────────────────────────
  const matchStatusBlob = { ...matchCounts, refreshedAt: new Date().toISOString() };

  // ── 5. Build points_geojson ─────────────────────────────────────────
  const pointsGeoJson = {
    type: "FeatureCollection" as const,
    features: points
      .filter((p) => typeof p.lat === "number" && typeof p.lon === "number")
      .map((p) => {
        const s = p.status_id ? statusById.get(p.status_id) : null;
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
          properties: {
            id: p.id,
            status_id: p.status_id,
            status_label: s?.label ?? null,
            color: s?.color ?? "#9ca3af",
            icon: s?.icon ?? null,
            collector_id: p.collector_id,
            collected_at: p.collected_at,
            matched: !!p.matched_response_id,
            match_status: p.matched_response_id ? "M1" : "F1",
          },
        };
      }),
  };

  // ── 6. Build responses_geojson ──────────────────────────────────────
  const responsesGeoJson = {
    type: "FeatureCollection" as const,
    features: responses
      .filter((r) => typeof r.lat === "number" && typeof r.lon === "number")
      .map((r) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [r.lon!, r.lat!] },
        properties: {
          id: r.id,
          address: r.address,
          status: r.status,
          matched: !!r.point_id,
          match_status: r.point_id ? "M1" : "R1",
        },
      })),
  };

  // ── 6.5. canvass_blob (only when canvass_mode is on) ─────────────────
  // Lightweight: total / visited / skipped / per-surveyor counts so the
  // Pulse tab can show canvass progress instead of generic match counts.
  const { data: settingsRaw } = await sbAny
    .from("project_settings")
    .select("canvass_mode")
    .eq("project_id", projectId)
    .maybeSingle() as { data: { canvass_mode: boolean } | null };
  const canvassMode = Boolean(settingsRaw?.canvass_mode);

  // canvass_blob is always written so the read path has a stable shape,
  // but visited/total only mean something when canvass_mode is true.
  let canvassBlob: {
    enabled: boolean;
    total: number;
    visited: number;
    skipped: number;
    pct: number;
    by_surveyor: Array<{ visited_by: string | null; count: number }>;
    refreshedAt: string;
  } = {
    enabled: canvassMode,
    total: 0,
    visited: 0,
    skipped: 0,
    pct: 0,
    by_surveyor: [],
    refreshedAt: new Date().toISOString(),
  };

  if (canvassMode) {
    const [allRes, visRes, skipRes, bySurveyorRes] = await Promise.all([
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
      sbAny
        .from("survey_universe")
        .select("visited_by")
        .eq("project_id", projectId)
        .eq("status", "visited")
        .limit(5_000),
    ]);
    const total = (allRes.count as number | null) ?? 0;
    const visited = (visRes.count as number | null) ?? 0;
    const skipped = (skipRes.count as number | null) ?? 0;
    const bySurveyorMap = new Map<string | null, number>();
    for (const r of (bySurveyorRes.data as Array<{ visited_by: string | null }>) ?? []) {
      bySurveyorMap.set(r.visited_by, (bySurveyorMap.get(r.visited_by) ?? 0) + 1);
    }
    const by_surveyor = Array.from(bySurveyorMap.entries())
      .map(([visited_by, count]) => ({ visited_by, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    canvassBlob = {
      enabled: true,
      total,
      visited,
      skipped,
      pct: total > 0 ? visited / total : 0,
      by_surveyor,
      refreshedAt: new Date().toISOString(),
    };
  }

  // ── 7. Upsert into dashboard_cache + write snapshots ────────────────
  const blobs: Record<CacheDataType, unknown> = {
    pulse_blob: pulseBlob,
    analyze_blob: analyzeBlob,
    match_status_blob: matchStatusBlob,
    points_geojson: pointsGeoJson,
    responses_geojson: responsesGeoJson,
    canvass_blob: canvassBlob,
  };

  const computedAt = new Date().toISOString();
  const sinceIso = opts.sinceIso ?? since24h;

  // Compute delta_summary against last snapshot if possible. Lightweight:
  // counts of new points and responses since `sinceIso`.
  const [newPointsRes, newRespRes] = await Promise.all([
    sbAny
      .from("points")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .gte("created_at", sinceIso),
    sbAny
      .from("survey_responses")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .gte("imported_at", sinceIso),
  ]);
  const delta = {
    new_points: (newPointsRes.count as number | null) ?? 0,
    new_responses: (newRespRes.count as number | null) ?? 0,
  };

  const sizes: Record<CacheDataType, { bytes: number; rows?: number }> = {
    pulse_blob: { bytes: 0 },
    analyze_blob: { bytes: 0 },
    match_status_blob: { bytes: 0 },
    points_geojson: { bytes: 0, rows: pointsGeoJson.features.length },
    responses_geojson: { bytes: 0, rows: responsesGeoJson.features.length },
    canvass_blob: { bytes: 0, rows: canvassBlob.total },
  };

  for (const key of Object.keys(blobs) as CacheDataType[]) {
    const payload = blobs[key];
    sizes[key].bytes = JSON.stringify(payload).length;
    await sbAny
      .from("dashboard_cache")
      .upsert(
        { project_id: projectId, data_type: key, payload, computed_at: computedAt },
        { onConflict: "project_id,data_type" },
      );
    await sbAny.from("analysis_versions").insert({
      project_id: projectId,
      data_type: key,
      payload,
      snapshot_at: computedAt,
      trigger,
      delta_summary: delta,
      is_daily_rollup: false,
    });
  }

  // Prune old snapshots (keep 50 most recent + daily rollups).
  await sbAny.rpc("prune_analysis_versions", { p_project_id: projectId });

  return { ok: true, projectId, trigger, blobs: sizes, delta };
}
