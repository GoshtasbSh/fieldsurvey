import { createServerSupabase } from "@/lib/supabase/server";
import type { MatchStatusCounts, MatchStatusRow } from "@/lib/match/status";
import { categorizeStatus, CANONICAL_STATUS_COLORS, type CanonicalStatus } from "@/lib/match/status-categorize";

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

/**
 * Per-status counts for the left-rail Status section. Sums two streams:
 *  1. Field points (each has a status_id → project_statuses.label).
 *  2. R1 survey responses (free-form status_label from raw_data, normalized
 *     into Keystone's canonical buckets via categorizeStatus).
 *
 * Both streams roll up into the same canonical labels so the legend matches
 * what the user sees on the map. Canonical buckets that the project hasn't
 * defined as a project_status (e.g. "Left Info") get appended with the
 * Keystone palette color so 100% of R1 markers are accounted for.
 */
export async function getStatusBreakdown(projectId: string) {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;

  const { data: statuses } = await sbAny
    .from("project_statuses")
    .select("id, label, color, icon, sort_order, is_default")
    .eq("project_id", projectId)
    .order("sort_order") as { data: Array<{ id: string; label: string; color: string; icon: string | null; sort_order: number; is_default: boolean }> | null };

  const { data: pointRows } = await sbAny
    .from("points")
    .select("status_id, project_statuses!inner(label)")
    .eq("project_id", projectId) as { data: Array<{ status_id: string; project_statuses: { label: string } | null }> | null };

  // R1 rows: free-form status_label from the v_match_status view.
  const { data: r1Rows } = await sbAny
    .from("v_match_status")
    .select("status_label,match_status")
    .eq("project_id", projectId)
    .eq("match_status", "R1") as { data: Array<{ status_label: string | null; match_status: string }> | null };

  const tally = new Map<string, number>();
  const bump = (label: string) => tally.set(label, (tally.get(label) ?? 0) + 1);
  for (const p of pointRows ?? []) {
    const label = p.project_statuses?.label;
    if (label) bump(label);
  }
  for (const r of r1Rows ?? []) bump(categorizeStatus(r.status_label));

  const total = (pointRows?.length ?? 0) + (r1Rows?.length ?? 0);

  // Project statuses come first (preserves the user's colors + sort order).
  const projectLabels = new Set((statuses ?? []).map((s) => s.label));
  const rows = (statuses ?? []).map((s) => ({
    ...s,
    count: tally.get(s.label) ?? 0,
    pct: total > 0 ? (tally.get(s.label) ?? 0) / total : 0,
  }));

  // Canonical Keystone buckets that the project hasn't defined as a typed
  // status but DO have R1 counts — append so the legend covers every R1.
  const CANONICAL_ORDER: CanonicalStatus[] = [
    "Completed", "No Answer", "Inaccessible", "Not Interested",
    "Left Info", "Vacant", "Follow Up", "Other", "Unknown",
  ];
  for (const label of CANONICAL_ORDER) {
    if (projectLabels.has(label)) continue;
    const count = tally.get(label) ?? 0;
    if (count === 0) continue;
    rows.push({
      id: `__canonical__${label}`,
      label,
      color: CANONICAL_STATUS_COLORS[label],
      icon: null,
      sort_order: 1000 + CANONICAL_ORDER.indexOf(label),
      is_default: false,
      count,
      pct: total > 0 ? count / total : 0,
    });
  }

  return rows;
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
    .select("point_id, response_id, project_id, status_id, status_label, lat, lon, is_matched, match_status, collected_at")
    .eq("project_id", projectId);
  return (data ?? []) as MatchStatusRow[];
}
