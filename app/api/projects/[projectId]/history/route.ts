/**
 * GET /api/projects/:projectId/history
 *
 * Lists analysis_versions for the project, newest first. Each row has
 * snapshot_at + trigger + delta_summary so the dropdown can render
 * "+12 points · 3 status changes" without fetching the full payload.
 *
 * Locked Q7: read = any project member (matches analytics permission).
 *
 * Query: ?limit=50 (default 50, max 200), ?dataType=pulse_blob (optional)
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const dataType = url.searchParams.get("dataType");

  let q = sb
    .from("analysis_versions")
    .select("id, data_type, snapshot_at, trigger, delta_summary, is_daily_rollup")
    .eq("project_id", projectId)
    .order("snapshot_at", { ascending: false })
    .limit(limit);
  if (dataType) q = q.eq("data_type", dataType);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ versions: data ?? [] });
}
