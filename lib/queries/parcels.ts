/**
 * PostGIS-backed helpers for parcels + project boundaries (M6).
 *
 * - listProjectBoundaries(projectId): pulls GeoJSON via the `boundaries_geojson`
 *   RPC so the API surface never has to know about PostGIS internals.
 * - snapAddressToParcel(): resolves an address string to its parcel's centroid
 *   when there's an exact match in the project's parcel set.
 *
 * Both helpers are member-readable per RLS.
 */

import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type BoundaryFeature = {
  id: string;
  name: string | null;
  /** Raw GeoJSON geometry (MultiPolygon). */
  geojson: GeoJSON.MultiPolygon | GeoJSON.Polygon;
  created_at: string;
};

export async function listProjectBoundaries(projectId: string): Promise<BoundaryFeature[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).rpc("boundaries_geojson", { p_project: projectId });
  if (!Array.isArray(data)) return [];
  return (data as Array<{
    id: string;
    name: string | null;
    geojson: GeoJSON.Geometry;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    name: r.name,
    geojson: r.geojson as GeoJSON.MultiPolygon | GeoJSON.Polygon,
    created_at: r.created_at,
  }));
}

/**
 * Pack the boundary rows into a single FeatureCollection so callers can pass
 * one source to MapLibre.
 */
export function boundariesAsFeatureCollection(rows: BoundaryFeature[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      id: r.id,
      properties: { id: r.id, name: r.name },
      geometry: r.geojson,
    })),
  };
}

/**
 * Try to snap a free-form address to a parcel centroid. Returns null when
 * no exact match is found.
 *
 * The `client` switch lets the universe-upload route call this with the
 * service-role client (caller is owner/admin so RLS would allow, but admin
 * client is consistent with the rest of that endpoint).
 */
export async function snapAddressToParcel(opts: {
  projectId: string;
  address: string;
  client?: "user" | "admin";
}): Promise<{ lat: number; lon: number; parcel_id: string } | null> {
  const sb = opts.client === "admin" ? createAdminSupabase() : await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc("find_parcel_for_address", {
    p_project: opts.projectId,
    p_address: opts.address,
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { parcel_id: string; centroid_lat: number; centroid_lon: number };
  if (typeof row.centroid_lat !== "number" || typeof row.centroid_lon !== "number") return null;
  return { parcel_id: row.parcel_id, lat: row.centroid_lat, lon: row.centroid_lon };
}
