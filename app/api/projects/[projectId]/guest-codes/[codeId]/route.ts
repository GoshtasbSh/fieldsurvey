/**
 * DELETE /api/projects/[projectId]/guest-codes/[codeId]
 *
 * Revoke a guest day-code by stamping revoked_at = now(). We don't physically
 * delete because any `points` rows the guest already inserted carry
 * guest_session_id as a FK; preserving the row keeps the audit trail.
 *
 * Owner/admin only.
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; codeId: string }> },
) {
  const { projectId, codeId } = await params;

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
    .from("guest_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", codeId)
    .eq("project_id", projectId)
    .is("revoked_at", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
