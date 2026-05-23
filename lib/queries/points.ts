import { createServerSupabase } from "@/lib/supabase/server";
import type { MatchStatusCounts, MatchStatusRow } from "@/lib/match/status";

export type PointRow = {
  id: string;
  project_id: string;
  status_id: string;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  address: string | null;
  notes: string | null;
  collector_id: string | null;
  collected_at: string;
  matched_response_id: string | null;
  client_id: string;
};

/** All points for a project, joined with status label + color. */
export async function listProjectPoints(projectId: string) {
  const sb = await createServerSupabase();
  const { data, error } = await sb
    .from("points")
    .select("id, project_id, status_id, lat, lon, accuracy_m, address, notes, collector_id, collected_at, matched_response_id, client_id, project_statuses!inner(label, color, icon)")
    .eq("project_id", projectId)
    .order("collected_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Per-status counts for the left-rail Status section. */
export async function getStatusBreakdown(projectId: string) {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: statuses } = await (sb.from("project_statuses") as any)
    .select("id, label, color, icon, sort_order, is_default")
    .eq("project_id", projectId)
    .order("sort_order") as { data: Array<{ id: string; label: string; color: string; icon: string | null; sort_order: number; is_default: boolean }> | null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (sb.from("points") as any)
    .select("status_id")
    .eq("project_id", projectId) as { data: Array<{ status_id: string }> | null };

  const counts = new Map<string, number>();
  for (const r of rows ?? []) counts.set(r.status_id, (counts.get(r.status_id) ?? 0) + 1);
  const total = rows?.length ?? 0;

  return (statuses ?? []).map((s) => ({
    ...s,
    count: counts.get(s.id) ?? 0,
    pct: total > 0 ? (counts.get(s.id) ?? 0) / total : 0,
  }));
}

/** M1/F1/R1 counts. Reads from v_match_status_counts. */
export async function getMatchStatusCounts(projectId: string): Promise<MatchStatusCounts> {
  const sb = await createServerSupabase();
  const { data } = await sb
    .from("v_match_status_counts")
    .select("m1_count, f1_count, r1_count, total_with_status")
    .eq("project_id", projectId)
    .maybeSingle();
  return data ?? { m1_count: 0, f1_count: 0, r1_count: 0, total_with_status: 0 };
}

/** Map-rendering rows including derived match_status. */
export async function getMatchStatusFeatures(projectId: string): Promise<MatchStatusRow[]> {
  const sb = await createServerSupabase();
  const { data } = await sb
    .from("v_match_status")
    .select("point_id, response_id, project_id, status_id, status_label, lat, lon, is_matched, match_status")
    .eq("project_id", projectId);
  return (data ?? []) as MatchStatusRow[];
}
