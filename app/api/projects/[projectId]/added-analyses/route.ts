/**
 * GET    /api/projects/[projectId]/added-analyses
 * POST   /api/projects/[projectId]/added-analyses
 * DELETE /api/projects/[projectId]/added-analyses?cardId=&addedAt=
 * PATCH  /api/projects/[projectId]/added-analyses
 *
 * Persists the user's spatial-analyses list on user_view_state.added_analyses (Migration 021).
 * Audits add/remove to analysis_versions with card_id in {add_analysis, remove_analysis}
 * (allowed by Migration 022's CHECK constraint).
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import type { AnalysisListItem } from "@/lib/analyses/types";

async function getAuthedClient() {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  return { sb, user };
}

async function assertMember(projectId: string) {
  const { sb, user } = await getAuthedClient();
  if (!user) return { sb, user: null as null, role: null as null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: projectId });
  return { sb, user, role };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const { sb, user, role } = await assertMember(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data, error } = await sbAny
    .from("user_view_state")
    .select("added_analyses, active_question_key")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    items: (data?.added_analyses ?? []) as AnalysisListItem[],
    activeQuestion: data?.active_question_key ?? null,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const { sb, user, role } = await assertMember(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json()) as { cardId: string; settings?: Record<string, unknown> };
  if (!body?.cardId) return NextResponse.json({ error: "cardId required" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: existing } = await sbAny
    .from("user_view_state")
    .select("added_analyses")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  const current = (existing?.added_analyses ?? []) as AnalysisListItem[];
  const next: AnalysisListItem = {
    cardId: body.cardId,
    settings: body.settings ?? {},
    addedAt: new Date().toISOString(),
  };
  const merged = [...current, next];

  const { error } = await sbAny
    .from("user_view_state")
    .upsert(
      { user_id: user.id, project_id: projectId, added_analyses: merged },
      { onConflict: "user_id,project_id" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sbAny.from("analysis_versions").insert({
    project_id: projectId,
    card_id: "add_analysis",
    user_id: user.id,
    payload: { addedCardId: body.cardId },
  });

  return NextResponse.json({ items: merged });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const url = new URL(req.url);
  const cardId = url.searchParams.get("cardId");
  const addedAt = url.searchParams.get("addedAt");
  if (!cardId || !addedAt) {
    return NextResponse.json({ error: "cardId+addedAt required" }, { status: 400 });
  }

  const { sb, user, role } = await assertMember(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: existing } = await sbAny
    .from("user_view_state")
    .select("added_analyses")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  const filtered = ((existing?.added_analyses ?? []) as AnalysisListItem[]).filter(
    (i) => !(i.cardId === cardId && i.addedAt === addedAt),
  );

  const { error } = await sbAny
    .from("user_view_state")
    .upsert(
      { user_id: user.id, project_id: projectId, added_analyses: filtered },
      { onConflict: "user_id,project_id" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sbAny.from("analysis_versions").insert({
    project_id: projectId,
    card_id: "remove_analysis",
    user_id: user.id,
    payload: { removedCardId: cardId, removedAddedAt: addedAt },
  });

  return NextResponse.json({ items: filtered });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = (await req.json()) as {
    cardId: string;
    addedAt: string;
    settings: Record<string, unknown>;
  };
  if (!body?.cardId || !body?.addedAt) {
    return NextResponse.json({ error: "cardId+addedAt required" }, { status: 400 });
  }

  const { sb, user, role } = await assertMember(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: existing } = await sbAny
    .from("user_view_state")
    .select("added_analyses")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  const items = ((existing?.added_analyses ?? []) as AnalysisListItem[]).map((i) =>
    i.cardId === body.cardId && i.addedAt === body.addedAt
      ? { ...i, settings: body.settings }
      : i,
  );

  const { error } = await sbAny
    .from("user_view_state")
    .upsert(
      { user_id: user.id, project_id: projectId, added_analyses: items },
      { onConflict: "user_id,project_id" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items });
}
