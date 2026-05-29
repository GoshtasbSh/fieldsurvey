/**
 * Project-boundary CRUD (M6).
 *
 * GET  — list boundaries as GeoJSON (member-readable).
 * POST — upload a GeoJSON Polygon/MultiPolygon (admin only).
 *
 * Body shape for POST (JSON):
 *   {
 *     name?: string;
 *     geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.Feature | GeoJSON.FeatureCollection
 *   }
 *
 * We accept any of those shapes and normalize to a single MultiPolygon
 * before handing it to PostGIS via `ST_GeomFromGeoJSON`.
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { listProjectBoundaries } from "@/lib/queries/parcels";

const PostBody = z.object({
  name: z.string().min(1).max(120).optional().nullable(),
  geojson: z.unknown(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const boundaries = await listProjectBoundaries(projectId);
  return NextResponse.json({ boundaries });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: projectId });
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  // Normalize to MultiPolygon GeoJSON. Accept Polygon, MultiPolygon, Feature
  // (with a Polygon/MultiPolygon geometry), or FeatureCollection (we use the
  // first feature with a polygonal geometry).
  const multi = normalizeToMultiPolygon(parsed.data.geojson);
  if (!multi) {
    return NextResponse.json(
      { error: "geojson must contain a Polygon or MultiPolygon" },
      { status: 400 },
    );
  }

  // Insert via a Postgres expression — `ST_Multi(ST_GeomFromGeoJSON(...))`
  // converts the JSON to PostGIS geometry. We use a single-row RPC-style
  // INSERT and rely on RLS for the admin gate.
  const insertSql = `
    insert into public.project_boundaries (project_id, name, geometry, created_by)
    select $1::uuid, $2::text, extensions.ST_Multi(extensions.ST_GeomFromGeoJSON($3))::extensions.geometry(MultiPolygon, 4326), $4::uuid
    returning id, name, created_at
  `;
  void insertSql;
  // Supabase JS doesn't expose raw SQL; instead we send the geometry as a
  // GeoJSON string via the Postgrest insert and let our SQL helper coerce it.
  // We accomplish that by writing through a tiny RPC `insert_project_boundary`
  // — but since the user said "minimum scope", we instead use the supabase
  // JS client's insert with the GeoJSON-as-text trick: PostGIS accepts a
  // GeoJSON string into a geometry column via implicit cast on insert IF
  // the GeoJSON has a `crs` field. To keep this simple and robust, we use
  // a one-shot helper RPC declared inline below.

  // Instead of inline raw SQL, use a helper RPC that we add via this route's
  // companion SQL — but we already shipped migration 012 without it. Fall
  // back to the documented pattern: insert geometry as a GeoJSON string +
  // explicit cast via PostgREST's `set` API. PostgREST supports geometry
  // inserts when the column accepts EWKB/EWKT; PostGIS auto-parses a
  // GeoJSON text via input function when the column type is `geometry`.
  //
  // The cleanest reliable approach here is a dedicated RPC. Add it now.

  const { data, error } = await sbAny.rpc("insert_project_boundary", {
    p_project: projectId,
    p_name: parsed.data.name ?? null,
    p_geojson: JSON.stringify(multi),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ boundary: row });
}

// ── GeoJSON normalization ──────────────────────────────────────────────────

type AnyGeoJSON = GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.Feature | GeoJSON.FeatureCollection;

function normalizeToMultiPolygon(input: unknown): GeoJSON.MultiPolygon | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as { type?: string } & Record<string, unknown>;

  if (obj.type === "Polygon") {
    return { type: "MultiPolygon", coordinates: [(obj as GeoJSON.Polygon).coordinates] };
  }
  if (obj.type === "MultiPolygon") {
    return { type: "MultiPolygon", coordinates: (obj as GeoJSON.MultiPolygon).coordinates };
  }
  if (obj.type === "Feature") {
    return normalizeToMultiPolygon((obj as GeoJSON.Feature).geometry);
  }
  if (obj.type === "FeatureCollection") {
    const fc = obj as GeoJSON.FeatureCollection;
    const merged: number[][][][] = [];
    for (const f of fc.features) {
      const m = normalizeToMultiPolygon(f.geometry as AnyGeoJSON);
      if (m) merged.push(...m.coordinates);
    }
    return merged.length > 0 ? { type: "MultiPolygon", coordinates: merged } : null;
  }
  return null;
}
