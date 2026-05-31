// lib/queries/medium-analyses.ts
import { createServerSupabase } from "@/lib/supabase/server";

const ZONE_SIZES: Record<string, number> = { "0.05": 0.05, "0.1": 0.1, "0.2": 0.2 };

function cellKey(lat: number, lon: number, deg: number) {
  return `${Math.floor(lon / deg)}_${Math.floor(lat / deg)}`;
}
function cellCenter(key: string, deg: number): { lat: number; lon: number } {
  const [bx, by] = key.split("_").map(Number);
  return { lon: (bx + 0.5) * deg, lat: (by + 0.5) * deg };
}
function r4(n: number) { return Math.round(n * 10000) / 10000; }

// ── A3: Multi-select co-occurrence ──────────────────────────────────────────
export async function getMultiselectUpset(projectId: string, settings: Record<string, string>) {
  const questionKey = settings["questionKey"] ?? settings["questionkey"] ?? "";
  const maxSets = Number(settings["maxSets"] ?? 8);
  const minCount = Number(settings["minCount"] ?? 2);
  if (!questionKey) return { error: "no_question_key" };

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).from("survey_responses")
    .select("raw_data").eq("project_id", projectId) as
    { data: Array<{ raw_data: Record<string, unknown> | null }> | null };
  if (!data) return { sets: [], intersections: [], n: 0 };

  const rawVals = data.map(r => String(r.raw_data?.[questionKey] ?? "")).filter(Boolean);
  const n = rawVals.length;
  const parsed = rawVals.map(v => v.split(",").map(s => s.trim()).filter(Boolean));

  const setCount = new Map<string, number>();
  for (const opts of parsed) for (const o of opts) setCount.set(o, (setCount.get(o) ?? 0) + 1);
  const topSets = [...setCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxSets).map(([name, size]) => ({ name, size }));
  const setNames = new Set(topSets.map(s => s.name));

  const intersectionCount = new Map<string, number>();
  for (const opts of parsed) {
    const filtered = opts.filter(o => setNames.has(o)).sort();
    for (let i = 0; i < filtered.length; i++) {
      for (let j = i + 1; j < filtered.length; j++) {
        const k = `${filtered[i]}∩${filtered[j]}`;
        intersectionCount.set(k, (intersectionCount.get(k) ?? 0) + 1);
      }
    }
  }
  const intersections = [...intersectionCount.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([pair, count]) => { const [a, b] = pair.split("∩"); return { sets: [a, b], count }; });

  return { sets: topSets, intersections, n, question_key: questionKey };
}

// ── A7: Weighted vs unweighted ───────────────────────────────────────────────
export async function getWeightedVsUnweighted(projectId: string, settings: Record<string, string>) {
  const groupKey = settings["groupKey"] ?? settings["groupkey"] ?? "";
  const questionKey = settings["questionKey"] ?? settings["questionkey"] ?? "";
  if (!groupKey || !questionKey) return { error: "missing_keys" };

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).from("survey_responses")
    .select("raw_data").eq("project_id", projectId) as
    { data: Array<{ raw_data: Record<string, unknown> | null }> | null };
  if (!data || data.length === 0) return { error: "no_data" };

  const rows = data
    .map(r => ({ g: String(r.raw_data?.[groupKey] ?? ""), v: r.raw_data?.[questionKey] }))
    .filter(r => r.g && r.v !== null && r.v !== undefined && r.v !== "");

  const groups = [...new Set(rows.map(r => r.g))];
  if (groups.length < 2) return { error: "single_group" };

  const n = rows.length;
  const k = groups.length;
  const targetSize = n / k;

  const groupStats = groups.map(g => {
    const vals = rows.filter(r => r.g === g).map(r => Number(r.v)).filter(Number.isFinite);
    const n_g = vals.length;
    const raw_mean = n_g > 0 ? vals.reduce((a, b) => a + b, 0) / n_g : 0;
    const weight = n_g > 0 ? targetSize / n_g : 1;
    return { group: g, n: n_g, raw_mean: r4(raw_mean), weight: r4(weight) };
  });

  const totalWeight = groupStats.reduce((s, g) => s + g.weight * g.n, 0);
  const weightedMean = r4(groupStats.reduce((s, g) => s + g.weight * g.n * g.raw_mean, 0) / Math.max(totalWeight, 1));
  const rawMean = r4(rows.map(r => Number(r.v)).filter(Number.isFinite).reduce((a, b) => a + b, 0) / Math.max(n, 1));

  return { raw_mean: rawMean, weighted_mean: weightedMean, delta: r4(weightedMean - rawMean), group_stats: groupStats, n, group_key: groupKey, question_key: questionKey };
}

// ── A12: Choropleth aggregation ──────────────────────────────────────────────
export async function getChoroplethAgg(projectId: string, settings: Record<string, string>) {
  const deg = ZONE_SIZES[settings["zoneUnit"] ?? "0.1"] ?? 0.1;
  const minN = Number(settings["minN"] ?? 3);

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).from("points")
    .select("lat, lon").eq("project_id", projectId) as
    { data: Array<{ lat: number | null; lon: number | null }> | null };
  if (!data) return { zones: [], n: 0 };

  const zoneMap = new Map<string, number>();
  for (const r of data) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const k = cellKey(r.lat, r.lon, deg);
    zoneMap.set(k, (zoneMap.get(k) ?? 0) + 1);
  }

  const zones = [...zoneMap.entries()]
    .filter(([, n]) => n >= minN)
    .sort((a, b) => b[1] - a[1])
    .map(([k, count]) => ({ zone_id: k, count, ...cellCenter(k, deg) }));

  return { zones, n: data.length, zone_unit: `${deg}deg`, n_zones: zones.length };
}

// ── A41: Who's missing ───────────────────────────────────────────────────────
export async function getWhosMissing(projectId: string, settings: Record<string, string>) {
  const deg = ZONE_SIZES[settings["zoneUnit"] ?? "0.1"] ?? 0.1;
  const minUnivN = Number(settings["minUniverseN"] ?? 5);

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const [{ data: univRows }, { data: pointRows }] = await Promise.all([
    sbAny.from("survey_universe").select("lat, lon").eq("project_id", projectId) as Promise<{ data: Array<{ lat: number | null; lon: number | null }> | null }>,
    sbAny.from("points").select("lat, lon").eq("project_id", projectId) as Promise<{ data: Array<{ lat: number | null; lon: number | null }> | null }>,
  ]);

  const univMap = new Map<string, number>();
  for (const r of univRows ?? []) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const k = cellKey(r.lat, r.lon, deg);
    univMap.set(k, (univMap.get(k) ?? 0) + 1);
  }
  const pointMap = new Map<string, number>();
  for (const r of pointRows ?? []) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const k = cellKey(r.lat, r.lon, deg);
    pointMap.set(k, (pointMap.get(k) ?? 0) + 1);
  }

  const totalUniv = [...univMap.values()].reduce((a, b) => a + b, 0);
  const totalPoints = [...pointMap.values()].reduce((a, b) => a + b, 0);

  const zones = [...univMap.entries()]
    .filter(([, n]) => n >= minUnivN)
    .map(([k, n_univ]) => {
      const n_resp = pointMap.get(k) ?? 0;
      const exp_pct = n_univ / Math.max(totalUniv, 1);
      const act_pct = n_resp / Math.max(totalPoints, 1);
      return { zone_id: k, n_universe: n_univ, n_responses: n_resp, expected_pct: r4(exp_pct), actual_pct: r4(act_pct), deficit: r4(exp_pct - act_pct), ...cellCenter(k, deg) };
    })
    .sort((a, b) => b.deficit - a.deficit);

  return { zones, n_zones: zones.length, total_universe: totalUniv, total_responses: totalPoints };
}

// ── A42: Lorenz curve + Gini ─────────────────────────────────────────────────
export async function getLorenzCurve(projectId: string, settings: Record<string, string>) {
  const deg = ZONE_SIZES[settings["zoneUnit"] ?? "0.1"] ?? 0.1;

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const [{ data: univRows }, { data: pointRows }] = await Promise.all([
    sbAny.from("survey_universe").select("lat, lon").eq("project_id", projectId) as Promise<{ data: Array<{ lat: number | null; lon: number | null }> | null }>,
    sbAny.from("points").select("lat, lon").eq("project_id", projectId) as Promise<{ data: Array<{ lat: number | null; lon: number | null }> | null }>,
  ]);

  const univMap = new Map<string, number>();
  for (const r of univRows ?? []) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const k = cellKey(r.lat, r.lon, deg);
    univMap.set(k, (univMap.get(k) ?? 0) + 1);
  }
  const pointMap = new Map<string, number>();
  for (const r of pointRows ?? []) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const k = cellKey(r.lat, r.lon, deg);
    pointMap.set(k, (pointMap.get(k) ?? 0) + 1);
  }

  const totalUniv = [...univMap.values()].reduce((a, b) => a + b, 0);
  const totalPoints = [...pointMap.values()].reduce((a, b) => a + b, 0);
  if (totalUniv === 0 || totalPoints === 0) return { error: "no_data" };

  const zones = [...univMap.entries()]
    .map(([k, n_univ]) => ({
      coverage_rate: (pointMap.get(k) ?? 0) / n_univ,
      univ_share: n_univ / totalUniv,
      visit_share: (pointMap.get(k) ?? 0) / Math.max(totalPoints, 1),
    }))
    .sort((a, b) => a.coverage_rate - b.coverage_rate);

  const lorenz_points: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  let cum_univ = 0, cum_visit = 0;
  for (const z of zones) {
    cum_univ += z.univ_share;
    cum_visit += z.visit_share;
    lorenz_points.push({ x: r4(cum_univ), y: r4(cum_visit) });
  }

  let area = 0;
  for (let i = 1; i < lorenz_points.length; i++) {
    area += (lorenz_points[i].x - lorenz_points[i-1].x) * (lorenz_points[i].y + lorenz_points[i-1].y) / 2;
  }
  const gini = r4(1 - 2 * area);

  return { lorenz_points, gini, n_zones: zones.length, total_universe: totalUniv, total_visits: totalPoints };
}
