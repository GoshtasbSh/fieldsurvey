import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

const FRESH_S = 15 * 60;

export type SidecarResult<T> = { payload: T; computedAt: string };

/**
 * Cached wrapper that POSTs to the Python sidecar deployed at
 * `NEXT_PUBLIC_SIDECAR_URL`. Reads the precomputed payload from
 * `dashboard_cache` first; only when the row is missing or older than 15
 * minutes does it round-trip to FastAPI. The sidecar writes its result back
 * into the same cache row, so subsequent reads stay cheap.
 *
 * The cache table column is `data_type` (migration 005) — keep this in sync
 * with `sidecar/lib/cache.py`.
 *
 * Note: a follow-up migration must widen the `data_type` CHECK constraint to
 * admit `A21_finish`, `A25_velocity`, `A11_kde`, `A8_gi_star` before sidecar
 * writes succeed. Until then the POST will 5xx and the dispatcher will return
 * `null` to the client.
 */
export async function callSidecar<T>(
  projectId: string,
  cardId: string,
  body: Record<string, unknown>,
): Promise<SidecarResult<T> | null> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await ((sb.from("dashboard_cache") as any)
    .select("payload, computed_at")
    .eq("project_id", projectId)
    .eq("data_type", cardId)
    .maybeSingle()) as { data: { payload: T; computed_at: string } | null };
  if (data) {
    const ageS = (Date.now() - new Date(data.computed_at).getTime()) / 1000;
    if (ageS < FRESH_S) return { payload: data.payload, computedAt: data.computed_at };
  }

  const baseUrl = process.env.NEXT_PUBLIC_SIDECAR_URL;
  if (!baseUrl) {
    // Dev / local: no sidecar configured — return cached if any, else null.
    return data ? { payload: data.payload, computedAt: data.computed_at } : null;
  }

  try {
    const res = await fetch(`${baseUrl}/sidecar/compute/${cardId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: projectId, ...body }),
    });
    if (!res.ok) return data ? { payload: data.payload, computedAt: data.computed_at } : null;
    const fresh = (await res.json()) as T;
    return { payload: fresh, computedAt: new Date().toISOString() };
  } catch {
    return data ? { payload: data.payload, computedAt: data.computed_at } : null;
  }
}
