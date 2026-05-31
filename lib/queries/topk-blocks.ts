import { createServerSupabase } from "@/lib/supabase/server";

/**
 * One row per parcel ranked by composite revisit score, returned by the
 * `topk_revisit_blocks` RPC (migration 016). The score formula is:
 *   (100 − achieved%) × 0.7  +  universe_addresses × 0.001
 * which rewards both high-coverage gaps and large pools.
 */
export type TopKBlockRow = {
  block_geoid: string;
  score: number;
  universe_addresses: number;
  achieved_pct: number | null;
};

/**
 * A51 — top-K parcels to revisit (admin/member prioritization).
 *
 * Defaults to top 10. RPC filters parcels with universe ≥ 5 inside the
 * coverage_by_block CTE so tiny pools don't dominate the queue.
 */
export async function getTopKBlocks(
  projectId: string,
  limit = 10,
): Promise<TopKBlockRow[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc("topk_revisit_blocks", {
    p_project_id: projectId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as TopKBlockRow[];
}
