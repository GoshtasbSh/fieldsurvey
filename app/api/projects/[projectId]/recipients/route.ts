/**
 * Change-report recipients (locked Q2).
 * Per-project list of external email addresses that receive the daily
 * digest. Owner + admin only; managed via the project Settings page.
 *
 * GET  — list (RLS owner/admin only)
 * POST — add { name?, email }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { z } from "zod";

const PostBody = z.object({
  name: z.string().min(1).max(120).optional().nullable(),
  email: z.string().email().max(254),
});

async function getRole(projectId: string) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { sb, user: null, role: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: projectId });
  return { sb, user, role: (role as string | null) ?? null };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { sb, user, role } = await getRole(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { data, error } = await sb
    .from("change_report_recipients")
    .select("id, name, email, paused, last_sent_at, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ recipients: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { sb, user, role } = await getRole(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data, error } = await sbAny
    .from("change_report_recipients")
    .insert({
      project_id: projectId,
      name: parsed.data.name ?? null,
      email: parsed.data.email.toLowerCase(),
      paused: false,
      added_by: user.id,
    })
    .select("id, name, email, paused, last_sent_at, created_at")
    .single();
  if (error) {
    // Unique-violation surfaces friendlier.
    if (error.code === "23505") {
      return NextResponse.json({ error: "That email is already on the list." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ recipient: data });
}
