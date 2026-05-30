import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * F1 queue row — a Completed point with no matched survey response yet.
 * These are "data gaps to chase" — surveyor came back but the office
 * hasn't found a matching online response (or the household never sent one).
 */
export type F1QueueRow = {
  id: string;
  lat: number;
  lon: number;
  collected_at: string;
};

const QUEUE_CAP = 100;

/**
 * A52 — F1 queue (Completed-but-unmatched points).
 *
 * Joins points → project_statuses to pick out 'Completed' (case-insensitive)
 * rows where `matched_response_id IS NULL`. Capped at 100 to keep the
 * response payload small; the analyze tab paginates from there if needed.
 *
 * Sort by oldest-first so the queue surfaces gaps that have been waiting
 * longest (the case-management UI assumes FIFO triage).
 */
export async function getF1Queue(projectId: string): Promise<F1QueueRow[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any)
    .from("points")
    .select("id, lat, lon, collected_at, status:project_statuses!inner(label)")
    .eq("project_id", projectId)
    .is("matched_response_id", null)
    .ilike("status.label", "completed")
    .order("collected_at", { ascending: true })
    .limit(QUEUE_CAP);
  if (error) throw new Error(error.message);
  // Strip the joined status object — the card only needs id/lat/lon/collected_at.
  return ((data ?? []) as Array<F1QueueRow & { status?: unknown }>).map((r) => ({
    id: r.id,
    lat: r.lat,
    lon: r.lon,
    collected_at: r.collected_at,
  }));
}
