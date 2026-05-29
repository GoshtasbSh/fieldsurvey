/**
 * PATCH /api/projects/:projectId/recipients/:recipientId
 * DELETE /api/projects/:projectId/recipients/:recipientId
 *
 * Owner + admin only (enforced by RLS + explicit role check).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { z } from "zod";

const PatchBody = z.object({
  name: z.string().min(1).max(120).nullable().optional(),
  paused: z.boolean().optional(),
});

async function guard(projectId: string) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { sb, user: null, role: null } as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: projectId });
  return { sb, user, role: (role as string | null) ?? null } as const;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; recipientId: string }> },
) {
  const { projectId, recipientId } = await params;
  const { sb, user, role } = await guard(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.paused !== undefined) update.paused = parsed.data.paused;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data, error } = await sbAny
    .from("change_report_recipients")
    .update(update)
    .eq("id", recipientId)
    .eq("project_id", projectId)
    .select("id, name, email, paused, last_sent_at, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ recipient: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; recipientId: string }> },
) {
  const { projectId, recipientId } = await params;
  const { sb, user, role } = await guard(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { error } = await sb
    .from("change_report_recipients")
    .delete()
    .eq("id", recipientId)
    .eq("project_id", projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
