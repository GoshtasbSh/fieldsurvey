/**
 * POST /api/projects/:projectId/cache/refresh
 *
 * Manually refresh the dashboard cache for a project. Owner + admin only.
 * Locked Q1 — "Recompute now" button.
 *
 * The refresh writes 5 blobs into dashboard_cache and a matching set of
 * snapshots into analysis_versions (trigger = "manual" here). The keep-50
 * + daily-rollup prune runs at the end.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { refreshProjectCache } from "@/lib/cache/refresh";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
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

  const result = await refreshProjectCache(projectId, { trigger: "manual" });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(result);
}
