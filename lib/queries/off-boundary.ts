import { createServerSupabase } from "@/lib/supabase/server";

/**
 * One row per off-boundary point returned by `off_boundary_points` (016).
 * `distance_m` is the geodesic distance from the point to the nearest
 * boundary edge of the project (NULL only if no boundaries exist, in which
 * case the RPC returns zero rows).
 */
export type OffBoundaryRow = {
  id: string;
  lat: number;
  lon: number;
  distance_m: number;
};

/**
 * A33 — points collected outside the project boundary (admin QC).
 *
 * Default buffer is 30m to allow for GPS jitter near the perimeter. Returns
 * empty array when no boundaries are drawn for the project.
 */
export async function getOffBoundary(
  projectId: string,
  bufferM = 30,
): Promise<OffBoundaryRow[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc("off_boundary_points", {
    p_project_id: projectId,
    p_buffer_m: bufferM,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as OffBoundaryRow[];
}
