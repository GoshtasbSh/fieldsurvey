/**
 * Helper for reading a single precomputed blob from `dashboard_cache`.
 * Returns null when the cache row does not exist; the caller decides
 * whether to fall back to a raw query.
 *
 * Cache keys (M5 adds canvass_blob):
 *   pulse_blob | analyze_blob | match_status_blob |
 *   points_geojson | responses_geojson | canvass_blob
 */

import { createServerSupabase } from "@/lib/supabase/server";

export type CacheKey =
  | "pulse_blob"
  | "analyze_blob"
  | "match_status_blob"
  | "points_geojson"
  | "responses_geojson"
  | "canvass_blob";

export type CachedBlob<T = unknown> = {
  payload: T;
  computed_at: string;
  age_seconds: number;
};

export async function readCachedBlob<T = unknown>(
  projectId: string,
  key: CacheKey,
): Promise<CachedBlob<T> | null> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("dashboard_cache") as any)
    .select("payload, computed_at")
    .eq("project_id", projectId)
    .eq("data_type", key)
    .maybeSingle();
  if (!data) return null;
  const row = data as { payload: T; computed_at: string };
  const ageMs = Date.now() - new Date(row.computed_at).getTime();
  return {
    payload: row.payload,
    computed_at: row.computed_at,
    age_seconds: Math.max(0, Math.floor(ageMs / 1000)),
  };
}

/**
 * Read multiple cache blobs in parallel. Returns a map keyed by cache key.
 */
export async function readCachedBlobs(
  projectId: string,
  keys: CacheKey[],
): Promise<Partial<Record<CacheKey, CachedBlob>>> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("dashboard_cache") as any)
    .select("data_type, payload, computed_at")
    .eq("project_id", projectId)
    .in("data_type", keys);
  const rows = (data ?? []) as Array<{
    data_type: CacheKey;
    payload: unknown;
    computed_at: string;
  }>;
  const out: Partial<Record<CacheKey, CachedBlob>> = {};
  for (const r of rows) {
    const ageMs = Date.now() - new Date(r.computed_at).getTime();
    out[r.data_type] = {
      payload: r.payload,
      computed_at: r.computed_at,
      age_seconds: Math.max(0, Math.floor(ageMs / 1000)),
    };
  }
  return out;
}
