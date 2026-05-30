import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * One row per (parcel × bucket) returned by `status_pattern_per_parcel` (016).
 * `bucket` is one of 'R' (refusal), 'NC' (non-contact / not-home), 'O' (other
 * non-interview). The RPC already filters out interviewed buckets.
 */
export type RefusalPatternRow = {
  parcel_id: string;
  bucket: "R" | "NC" | "O";
  n: number;
};

/**
 * A22 — refusal / not-home / other pattern per parcel.
 */
export async function getRefusalPattern(projectId: string): Promise<RefusalPatternRow[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc("status_pattern_per_parcel", { p_project_id: projectId });
  if (error) throw new Error(error.message);
  return (data ?? []) as RefusalPatternRow[];
}
