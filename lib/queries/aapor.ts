import { createServerSupabase } from "@/lib/supabase/server";
import { computeAaporRates, type AaporCounts, type AaporRates } from "@/lib/analyses/formulas/aapor";

export type AaporResult = { counts: AaporCounts; rates: AaporRates };

/**
 * A16/A17/A18 — fetch AAPOR outcome counts via the `aapor_outcome_counts` RPC
 * (migration 016) and compute rates client-side via `computeAaporRates`.
 *
 * Missing buckets default to 0 so the rate formulas never see undefined.
 */
export async function getAaporResult(projectId: string): Promise<AaporResult> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).rpc("aapor_outcome_counts", { p_project_id: projectId });
  const raw = (data ?? {}) as unknown as Record<string, number>;
  const counts: AaporCounts = {
    I:  raw.I  ?? 0,
    P:  raw.P  ?? 0,
    R:  raw.R  ?? 0,
    NC: raw.NC ?? 0,
    O:  raw.O  ?? 0,
    UH: raw.UH ?? 0,
    UO: raw.UO ?? 0,
    UNMAPPED: raw.UNMAPPED ?? 0,
  };
  return { counts, rates: computeAaporRates(counts) };
}
