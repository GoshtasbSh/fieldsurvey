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

  // Insert via the `insert_project_boundary` helper RPC — it casts the
  // GeoJSON string to PostGIS geometry server-side. RLS still enforces the
  // admin gate (SECURITY INVOKER).
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

function normalizeToMultiPolygon(input: unknown): GeoJSON.MultiPolygon | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as { type?: string } & Record<string, unknown>;

  if (obj.type === "Polygon") {
    const p = obj as unknown as GeoJSON.Polygon;
    return { type: "MultiPolygon", coordinates: [p.coordinates] };
  }
  if (obj.type === "MultiPolygon") {
    const mp = obj as unknown as GeoJSON.MultiPolygon;
    return { type: "MultiPolygon", coordinates: mp.coordinates };
  }
  if (obj.type === "Feature") {
    const f = obj as unknown as GeoJSON.Feature;
    return normalizeToMultiPolygon(f.geometry);
  }
  if (obj.type === "FeatureCollection") {
    const fc = obj as unknown as GeoJSON.FeatureCollection;
    const merged: number[][][][] = [];
    for (const f of fc.features) {
      const m = normalizeToMultiPolygon(f.geometry);
      if (m) merged.push(...m.coordinates);
    }
    return merged.length > 0 ? { type: "MultiPolygon", coordinates: merged } : null;
  }
  return null;
}
