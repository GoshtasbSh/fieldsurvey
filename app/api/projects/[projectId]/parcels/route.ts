/**
 * GET    /api/projects/[projectId]/parcels — member-readable summary
 * DELETE /api/projects/[projectId]/parcels — admin clear (requires `x-confirm: yes`)
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  // Explicit membership check before reading project-scoped data —
  // consistent with mutation routes and resilient if RLS is ever relaxed.
  const { data: role } = await sbAny.rpc("project_role", { p_project: projectId });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [{ count }, { data: latest }] = await Promise.all([
    sbAny
      .from("parcels")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    sbAny
      .from("parcels")
      .select("created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    total: (count as number | null) ?? 0,
    last_upload_at: (latest as { created_at: string } | null)?.created_at ?? null,
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (req.headers.get("x-confirm") !== "yes") {
    return NextResponse.json({ error: "confirmation required" }, { status: 400 });
  }
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

  const { error } = await sbAny.from("parcels").delete().eq("project_id", projectId);
  if (error) return NextResponse.json({ error: "delete failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
