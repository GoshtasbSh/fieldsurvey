/**
 * GET    /api/projects/[projectId]/universe       — list (optionally filtered by status)
 * DELETE /api/projects/[projectId]/universe       — clear (requires `x-confirm: yes`)
 * PATCH  /api/projects/[projectId]/universe       — toggle project_settings.canvass_mode
 *
 * Members can GET; owner/admin can DELETE; owner/admin can PATCH the toggle.
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";

const ToggleBody = z.object({ canvass_mode: z.boolean() });
const STATUSES = ["not_visited", "visited", "skipped"] as const;

async function withRole(projectId: string) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { sb, user: null, role: null as string | null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: role } = await (sb as any).rpc("project_role", { p_project: projectId });
  return { sb, user, role: (role as string | null) ?? null };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { sb, user, role } = await withRole(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const statusParam = sp.get("status");
  const limit = Math.min(parseInt(sp.get("limit") ?? "200", 10) || 200, 1000);
  const offset = Math.max(parseInt(sp.get("offset") ?? "0", 10) || 0, 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (sb.from("survey_universe") as any)
    .select(
      "id, address, lat, lon, status, visited_at, visited_by, point_id, external_id, created_at, updated_at",
      { count: "exact" },
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (statusParam && (STATUSES as readonly string[]).includes(statusParam)) {
    q = q.eq("status", statusParam);
  }

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [], total: count ?? 0 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (req.headers.get("x-confirm") !== "yes") {
    return NextResponse.json({ error: "confirmation required" }, { status: 400 });
  }
  const { sb, user, role } = await withRole(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb as any)
    .from("survey_universe")
    .delete()
    .eq("project_id", projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { sb, user, role } = await withRole(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = ToggleBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  // Upsert against (project_id) — settings rows are unique per project.
  const { error } = await sbAny
    .from("project_settings")
    .upsert(
      { project_id: projectId, canvass_mode: parsed.data.canvass_mode },
      { onConflict: "project_id" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, canvass_mode: parsed.data.canvass_mode });
}
