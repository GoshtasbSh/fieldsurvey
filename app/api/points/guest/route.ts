/**
 * POST /api/points/guest
 *
 * Insert a point on behalf of a guest. Guests do not have a Supabase auth
 * session — instead they carry the signed `fs_guest` cookie issued by
 * /api/guest/start. The cookie payload binds the session to a single
 * project, so any attempt to insert against a different project_id is
 * rejected before we touch the DB.
 *
 * Idempotent on (project_id, client_id) so offline replay is safe.
 * Mirrors the body shape of /api/points/route.ts so the mobile client can
 * use a single insert function with a swappable endpoint.
 *
 * Body: { project_id, status_id, lat, lon, accuracy_m?, address?, notes?,
 *         collected_at?, client_id, is_offline_sync?, photo_paths? }
 * Response 200: { id, deduped }
 * Response 401: { ok: false, error: "no guest session" } | "project mismatch"
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { readGuestSession } from "@/lib/auth/guest-session";
import { findNearestNotVisited, markUniverseVisited } from "@/lib/queries/universe";

const Body = z.object({
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

export async function POST(req: NextRequest) {
  const guest = await readGuestSession();
  if (!guest) {
    return NextResponse.json(
      { ok: false, error: "no guest session" },
      { status: 401 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  }
  const body = parsed.data;

  // The cookie pins the session to one project. A guest cannot write to a
  // different project even if they craft the request manually.
  if (body.project_id !== guest.projectId) {
    return NextResponse.json(
      { ok: false, error: "project mismatch" },
      { status: 401 },
    );
  }

  const admin = createAdminSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAny = admin as any;

  // Idempotency on (project_id, client_id) — same key as auth path.
  const { data: existing } = (await adminAny
    .from("points")
    .select("id")
    .eq("project_id", body.project_id)
    .eq("client_id", body.client_id)
    .maybeSingle()) as { data: { id: string } | null };

  if (existing) {
    return NextResponse.json({ id: existing.id, deduped: true });
  }

  const { data: point, error } = (await adminAny
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
      collector_id: null,
      guest_session_id: guest.sessionId,
      client_id: body.client_id,
      is_offline_sync: body.is_offline_sync ?? false,
      geocode_source: "gps",
    })
    .select("id")
    .single()) as { data: { id: string } | null; error: { message: string } | null };

  if (error || !point) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  // Photo paths: same validation rules as the auth path — must be
  // scoped under `${project_id}/${client_id}/` and contain no `..`.
  if (body.photo_paths?.length) {
    const expectedPrefix = `${body.project_id}/${body.client_id}/`;
    const valid = body.photo_paths.filter(
      (p) => p.startsWith(expectedPrefix) && !p.includes(".."),
    );
    if (valid.length < body.photo_paths.length) {
      return NextResponse.json({ ok: false, error: "invalid photo_paths" }, { status: 400 });
    }
    const rows = valid.map((p) => ({
      point_id: point.id,
      storage_path: p,
      uploaded_by: null,
    }));
    await adminAny.from("point_photos").insert(rows);
  }

  // Canvass marker (mirrors /api/points). Guests have no profile id, so
  // visited_by is null — the audit trail is the guest_session_id on the
  // point row itself.
  try {
    const { data: settings } = await adminAny
      .from("project_settings")
      .select("canvass_mode, match_radius_m")
      .eq("project_id", body.project_id)
      .maybeSingle() as { data: { canvass_mode: boolean; match_radius_m: number } | null };
    if (settings?.canvass_mode) {
      const nearest = await findNearestNotVisited({
        projectId: body.project_id,
        lat: body.lat,
        lon: body.lon,
        radiusM: settings.match_radius_m ?? 30,
        client: "admin",
      });
      if (nearest) {
        await markUniverseVisited({
          rowId: nearest.id,
          pointId: point.id,
          visitedBy: null,
        });
      }
    }
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({ id: point.id, deduped: false });
}
