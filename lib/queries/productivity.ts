import { createServerSupabase } from "@/lib/supabase/server";

/**
 * One row per surveyor returned by `productivity_per_surveyor` (016).
 * RPC enforces shifts ≥ 3 so the n_min filter is already baked in.
 */
export type ProductivityRow = {
  collector_id: string;
  name: string;
  points: number;
  shifts: number;
  ppshift: number;
};

/**
 * A28 — points/shift per surveyor (admin).
 */
export async function getProductivity(projectId: string): Promise<ProductivityRow[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc("productivity_per_surveyor", { p_project_id: projectId });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductivityRow[];
}

/**
 * One row per surveyor returned by `gps_accuracy_outliers` (016).
 * `flagged` counts points where accuracy_m > threshold (default 50m).
 */
export type GpsOutlierRow = {
  collector_id: string;
  name: string;
  median_acc: number;
  flagged: number;
  total: number;
};

/**
 * A29 — GPS accuracy outliers per surveyor (admin).
 */
export async function getGpsOutliers(
  projectId: string,
  threshM = 50,
): Promise<GpsOutlierRow[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc("gps_accuracy_outliers", {
    p_project_id: projectId,
    p_thresh_m: threshM,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as GpsOutlierRow[];
}
