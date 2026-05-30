import { createServerSupabase } from "@/lib/supabase/server";

/**
 * One row per parcel returned by the `coverage_by_block` RPC (migration 016).
 *
 * `block_geoid` carries the parcel UUID as text (see schema notes in 016
 * for why we report at parcel scope rather than ACS block-group scope).
 */
export type CoverageRow = {
  block_geoid: string;
  universe_addresses: number;
  points_collected: number;
};

/**
 * A19 — universe penetration: pulls per-parcel universe size + collected
 * count via `coverage_by_block` (migration 016, security invoker).
 *
 * Returns an empty array on RPC failure or when neither universe nor
 * points are loaded for the project (the card handles the empty state).
 */
export async function getCoverageBlocks(projectId: string): Promise<CoverageRow[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc("coverage_by_block", { p_project_id: projectId });
  if (error) throw new Error(error.message);
  return (data ?? []) as CoverageRow[];
}
