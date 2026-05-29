/**
 * POST /api/projects/[projectId]/parcels/upload
 *
 * Bulk-ingest parcel polygons from GeoJSON. Owner/admin only.
 *
 * Content-type: multipart/form-data; field `file` is a GeoJSON
 * FeatureCollection. Each feature must have a Polygon or MultiPolygon
 * geometry; properties optional (`address`, `parcel_apn`, `county`,
 * `external_id`).
 *
 * Calls `insert_parcels_batch` server-side which computes ST_Centroid for
 * each polygon and writes into `public.parcels`. RLS gates the insert at
 * the table level so the RPC stays SECURITY INVOKER.
 *
 * Returns { inserted, skipped, total }.
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

const BATCH = 200;
const MAX_FEATURES = 100_000;

type ParcelInput = {
  address: string | null;
  parcel_apn: string | null;
  county: string | null;
  external_id: string | null;
  geojson: string;
};

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

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return NextResponse.json({ error: "file is not valid JSON" }, { status: 400 });
  }

  const features = extractFeatures(raw);
  if (features.length === 0) {
    return NextResponse.json({ error: "no Polygon/MultiPolygon features found" }, { status: 400 });
  }
  if (features.length > MAX_FEATURES) {
    return NextResponse.json(
      { error: `too many features (max ${MAX_FEATURES})` },
      { status: 413 },
    );
  }

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < features.length; i += BATCH) {
    const slice = features.slice(i, i + BATCH);
    const payload: ParcelInput[] = slice.map((f) => ({
      address: stringOrNull(f.properties?.address),
      parcel_apn:
        stringOrNull(f.properties?.parcel_apn) ??
        stringOrNull(f.properties?.parcelapn) ??
        stringOrNull(f.properties?.PARCEL_ID),
      county: stringOrNull(f.properties?.county),
      external_id:
        stringOrNull(f.properties?.external_id) ?? stringOrNull(f.properties?.id),
      geojson: JSON.stringify(f.geometry),
    }));

    const { data, error } = await sbAny.rpc("insert_parcels_batch", {
      p_project: projectId,
      p_rows: payload,
    });
    if (error) {
      errors.push(error.message);
      skipped += slice.length;
      continue;
    }
    const count = (data as number | null) ?? 0;
    inserted += count;
    skipped += slice.length - count;
  }

  return NextResponse.json({ inserted, skipped, total: features.length, errors });
}

// ── GeoJSON helpers ─────────────────────────────────────────────────────────

type PolygonalFeature = {
  properties: Record<string, unknown> | null;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};

function extractFeatures(input: unknown): PolygonalFeature[] {
  if (!input || typeof input !== "object") return [];
  const obj = input as { type?: string } & Record<string, unknown>;

  // Allow a bare Polygon/MultiPolygon at the top level.
  if (obj.type === "Polygon" || obj.type === "MultiPolygon") {
    return [{ properties: null, geometry: obj as unknown as GeoJSON.Polygon | GeoJSON.MultiPolygon }];
  }
  if (obj.type === "Feature") {
    const f = obj as unknown as GeoJSON.Feature;
    if (f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon") {
      return [{ properties: f.properties ?? null, geometry: f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon }];
    }
    return [];
  }
  if (obj.type === "FeatureCollection") {
    const fc = obj as unknown as GeoJSON.FeatureCollection;
    const out: PolygonalFeature[] = [];
    for (const f of fc.features ?? []) {
      if (f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon") {
        out.push({ properties: f.properties ?? null, geometry: f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon });
      }
    }
    return out;
  }
  return [];
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
