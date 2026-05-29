/**
 * DELETE /api/projects/[projectId]/boundaries/[boundaryId]
 *
 * Owner/admin only — hard-delete (boundaries carry no audit trail beyond
 * created_at; future ingest can re-upload).
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; boundaryId: string }> },
) {
  const { projectId, boundaryId } = await params;
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

  const { error } = await sbAny
    .from("project_boundaries")
    .delete()
    .eq("id", boundaryId)
    .eq("project_id", projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
