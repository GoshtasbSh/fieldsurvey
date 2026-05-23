import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { z } from "zod";

const PointInsert = z.object({
  project_id: z.string().uuid(),
  status_id: z.string().uuid(),
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180),
  accuracy_m: z.number().nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  collected_at: z.string().datetime().optional(),
  client_id: z.string().min(1).max(80),
  is_offline_sync: z.boolean().optional(),
  photo_paths: z.array(z.string()).max(20).optional(),
});

/**
 * Create a point. Idempotent on (project_id, client_id) thanks to the
 * unique index in migration 002. Returns the point row.
 *
 * Body: { project_id, status_id, lat, lon, ... , client_id, photo_paths? }
 */
export async function POST(req: NextRequest) {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = PointInsert.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const body = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;

  // Upsert on (project_id, client_id) for offline replay idempotency
  const { data: existing } = await sbAny
    .from("points")
    .select("id")
    .eq("project_id", body.project_id)
    .eq("client_id", body.client_id)
    .maybeSingle() as { data: { id: string } | null };

  if (existing) return NextResponse.json({ id: existing.id, deduped: true });

  const { data: point, error } = await sbAny
    .from("points")
    .insert({
      project_id: body.project_id,
      status_id: body.status_id,
      lat: body.lat,
      lon: body.lon,
      accuracy_m: body.accuracy_m ?? null,
      address: body.address ?? null,
      notes: body.notes ?? null,
      collected_at: body.collected_at ?? new Date().toISOString(),
      collector_id: user.id,
      client_id: body.client_id,
      is_offline_sync: body.is_offline_sync ?? false,
      geocode_source: "gps",
    })
    .select("id")
    .single() as { data: { id: string } | null; error: { message: string } | null };

  if (error || !point) return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });

  // Attach photo rows
  if (body.photo_paths?.length) {
    const rows = body.photo_paths.map((p) => ({
      point_id: point.id,
      storage_path: p,
      uploaded_by: user.id,
    }));
    await sbAny.from("point_photos").insert(rows);
  }

  return NextResponse.json({ id: point.id, deduped: false });
}
