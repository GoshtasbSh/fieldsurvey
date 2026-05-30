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
