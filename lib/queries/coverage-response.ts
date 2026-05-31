// lib/queries/coverage-response.ts
import { createServerSupabase } from "@/lib/supabase/server";

type CoverageZone = {
  zone_id: string;
  n_universe: number;
  n_visited: number;
  n_responses: number;
  answer_pct: number | null;
  coverage_pct: number | null;
  category: string;
  lat: number;
  lon: number;
};

const ZONE_DEG = 0.1;

function cellKey(lat: number, lon: number): string {
  const bx = Math.floor(lon / ZONE_DEG);
  const by = Math.floor(lat / ZONE_DEG);
  return `${bx}_${by}`;
}
function cellCenter(key: string): { lat: number; lon: number } {
  const [bx, by] = key.split("_").map(Number);
  return { lon: (bx + 0.5) * ZONE_DEG, lat: (by + 0.5) * ZONE_DEG };
}
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function getCoverageResponse(
  projectId: string,
  settings: Record<string, string>,
): Promise<{ zones: CoverageZone[]; question_key: string; answer_option: string; zone_unit: string }> {
  const questionKey = settings["questionKey"] ?? "";
  const answerOption = settings["answerOption"] ?? "";
  const minN = Number(settings["minN"] ?? 10);

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;

  const { data: univRows } = await sbAny
    .from("survey_universe")
    .select("lat, lon, status")
    .eq("project_id", projectId) as { data: Array<{ lat: number | null; lon: number | null; status: string }> | null };

  const { data: pointRows } = await sbAny
    .from("points")
    .select("lat, lon, survey_responses!matched_response_id(raw_data)")
    .eq("project_id", projectId)
    .not("matched_response_id", "is", null) as {
      data: Array<{
        lat: number | null; lon: number | null;
        survey_responses: { raw_data: Record<string, unknown> | null } | null;
      }> | null
    };

  const univMap = new Map<string, { total: number; visited: number }>();
  for (const r of univRows ?? []) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const k = cellKey(r.lat, r.lon);
    const cur = univMap.get(k) ?? { total: 0, visited: 0 };
    cur.total++;
    if (r.status === "visited") cur.visited++;
    univMap.set(k, cur);
  }

  const respMap = new Map<string, { n: number; n_match: number }>();
  for (const r of pointRows ?? []) {
    if (typeof r.lat !== "number" || typeof r.lon !== "number") continue;
    const k = cellKey(r.lat, r.lon);
    const cur = respMap.get(k) ?? { n: 0, n_match: 0 };
    cur.n++;
    const val = String(r.survey_responses?.raw_data?.[questionKey] ?? "");
    if (val === answerOption) cur.n_match++;
    respMap.set(k, cur);
  }

  const allKeys = new Set([...univMap.keys(), ...respMap.keys()]);
  const zones: CoverageZone[] = [];

  for (const k of allKeys) {
    const univ = univMap.get(k);
    const resp = respMap.get(k);
    const n_universe = univ?.total ?? 0;
    const n_visited = univ?.visited ?? 0;
    const n_responses = resp?.n ?? 0;
    const { lat, lon } = cellCenter(k);

    if (n_responses < minN) {
      zones.push({ zone_id: k, n_universe, n_visited, n_responses, answer_pct: null, coverage_pct: null, category: "suppressed", lat, lon });
      continue;
    }

    const coverage_pct = n_universe > 0 ? n_visited / n_universe : null;
    const answer_pct = n_responses > 0 && answerOption ? (resp?.n_match ?? 0) / n_responses : null;
    zones.push({ zone_id: k, n_universe, n_visited, n_responses, answer_pct, coverage_pct, category: "pending", lat, lon });
  }

  const validZones = zones.filter((z) => z.category !== "suppressed");
  const covMedian = median(validZones.map((z) => z.coverage_pct ?? 0));
  const ansMedian = median(validZones.map((z) => z.answer_pct ?? 0));
  for (const z of validZones) {
    const hiCov = (z.coverage_pct ?? 0) >= covMedian;
    const hiAns = (z.answer_pct ?? 0) >= ansMedian;
    z.category = hiCov && hiAns ? "HH" : hiCov && !hiAns ? "HL" : !hiCov && hiAns ? "LH" : "LL";
  }

  return { zones, question_key: questionKey, answer_option: answerOption, zone_unit: "0.1deg_grid" };
}
