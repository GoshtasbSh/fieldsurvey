import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

const FRESH_S = 15 * 60;

export type SidecarResult<T> = { payload: T; computedAt: string };

/**
 * Cached wrapper that POSTs to the Python sidecar deployed at `SIDECAR_URL`.
 * Reads the precomputed payload from `dashboard_cache` first; only when the
 * row is missing or older than 15 minutes does it round-trip to FastAPI.
 * The sidecar writes its result back into the same cache row, so subsequent
 * reads stay cheap.
 *
 * The cache table column is `data_type` (migration 005) — keep this in sync
 * with `sidecar/lib/cache.py`. Cache CHECK constraint widened in
 * supabase/migrations/017_sidecar_cache_keys.sql.
 *
 * Auth: the sidecar requires the `x-sidecar-secret` header to match
 * `SIDECAR_SECRET`. Both `SIDECAR_URL` and `SIDECAR_SECRET` are server-only —
 * they must NOT use the `NEXT_PUBLIC_` prefix so the values stay out of the
 * client bundle.
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

  const baseUrl = process.env.SIDECAR_URL;
  if (!baseUrl) {
    // Dev / local: no sidecar configured — return cached if any, else null.
    return data ? { payload: data.payload, computedAt: data.computed_at } : null;
  }

  try {
    const res = await fetch(`${baseUrl}/sidecar/compute/${cardId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sidecar-secret": process.env.SIDECAR_SECRET ?? "",
      },
      body: JSON.stringify({ project_id: projectId, ...body }),
    });
    if (!res.ok) return data ? { payload: data.payload, computedAt: data.computed_at } : null;
    const fresh = (await res.json()) as T;
    return { payload: fresh, computedAt: new Date().toISOString() };
  } catch {
    return data ? { payload: data.payload, computedAt: data.computed_at } : null;
  }
}
