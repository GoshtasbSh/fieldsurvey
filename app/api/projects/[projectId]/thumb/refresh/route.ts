/**
 * POST /api/projects/[projectId]/thumb/refresh
 *
 * Regenerates the /home thumbnail for a project. Owner/admin only.
 *
 * Pipeline:
 *   1. Look up the project's center + zoom (RLS-gated read).
 *   2. Stitch 4 Carto Dark Matter tiles into a 480×280 PNG.
 *   3. Upload to `project-thumbs/{projectId}.png` via the service-role
 *      client (the bucket has no anon/authenticated write policy).
 *   4. Update `projects.thumb_path` + `thumb_updated_at`.
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { generateProjectThumb } from "@/lib/thumb/generate";

const BUCKET = "project-thumbs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
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

  const { data: project } = await sbAny
    .from("projects")
    .select("center_lat, center_lon, default_zoom")
    .eq("id", projectId)
    .maybeSingle() as { data: { center_lat: number; center_lon: number; default_zoom: number | null } | null };
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const result = await generateProjectThumb({
    centerLat: project.center_lat,
    centerLon: project.center_lon,
    zoom: Math.min(13, Math.max(10, project.default_zoom ?? 11)),
  });

  const admin = createAdminSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAny = admin as any;
  const path = `${projectId}.png`;
  const { error: uploadErr } = await adminAny.storage
    .from(BUCKET)
    .upload(path, result.png, {
      contentType: "image/png",
      cacheControl: "public, max-age=3600",
      upsert: true,
    });
  if (uploadErr) {
    return NextResponse.json({ error: `upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  const { error: updateErr } = await adminAny
    .from("projects")
    .update({ thumb_path: path, thumb_updated_at: new Date().toISOString() })
    .eq("id", projectId);
  if (updateErr) {
    return NextResponse.json({ error: `db update failed: ${updateErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, path });
}
