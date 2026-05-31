/**
 * GET /api/projects/:projectId/history/:versionId
 *
 * Returns one analysis_versions row INCLUDING the full payload. Used by
 * the History dropdown when the user clicks "View" — the dashboard then
 * paints from this payload instead of the live cache/raw queries.
 *
 * Read = any project member (matches analytics permission, locked Q7).
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; versionId: string }> },
) {
  const { projectId, versionId } = await params;
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: projectId });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data, error } = await sbAny
    .from("analysis_versions")
    .select("id, data_type, snapshot_at, trigger, delta_summary, is_daily_rollup, payload")
    .eq("project_id", projectId)
    .eq("id", versionId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "fetch failed" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ version: data });
}
