/**
 * GET    /api/projects/[projectId]/pinned-layers
 * POST   /api/projects/[projectId]/pinned-layers          — pin a new layer
 * DELETE /api/projects/[projectId]/pinned-layers?cardId=&pinnedAt=  — unpin
 * PATCH  /api/projects/[projectId]/pinned-layers          — update (visibility, name, cachedResult)
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import type { PinnedAnalysisLayer } from "@/lib/analyses/types";

async function assertMember(projectId: string) {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { sb, user: null as null, role: null as null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: projectId });
  return { sb: sbAny, user, role };
}

async function readLayers(sb: unknown, userId: string, projectId: string): Promise<PinnedAnalysisLayer[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any)
    .from("user_view_state")
    .select("pinned_layers")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.pinned_layers ?? []) as PinnedAnalysisLayer[];
}

async function writeLayers(sb: unknown, userId: string, projectId: string, layers: PinnedAnalysisLayer[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sb as any)
    .from("user_view_state")
    .upsert({ user_id: userId, project_id: projectId, pinned_layers: layers }, { onConflict: "user_id,project_id" });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { sb, user, role } = await assertMember(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const layers = await readLayers(sb, user.id, projectId);
  return NextResponse.json({ layers });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { sb, user, role } = await assertMember(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json()) as Partial<PinnedAnalysisLayer>;
  if (!body?.cardId) return NextResponse.json({ error: "cardId required" }, { status: 400 });

  const existing = await readLayers(sb, user.id, projectId);
  const newLayer: PinnedAnalysisLayer = {
    cardId: body.cardId,
    layerName: body.layerName ?? body.cardId,
    settings: body.settings ?? {},
    visible: body.visible ?? true,
    pinnedAt: new Date().toISOString(),
    cachedResult: body.cachedResult,
    cachedAt: body.cachedResult ? new Date().toISOString() : undefined,
  };
  const { error } = await writeLayers(sb, user.id, projectId, [...existing, newLayer]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ layers: [...existing, newLayer] });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const url = new URL(req.url);
  const cardId = url.searchParams.get("cardId");
  const pinnedAt = url.searchParams.get("pinnedAt");
  if (!cardId || !pinnedAt) return NextResponse.json({ error: "cardId+pinnedAt required" }, { status: 400 });

  const { sb, user, role } = await assertMember(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const existing = await readLayers(sb, user.id, projectId);
  const filtered = existing.filter((l) => !(l.cardId === cardId && l.pinnedAt === pinnedAt));
  const { error } = await writeLayers(sb, user.id, projectId, filtered);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ layers: filtered });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = (await req.json()) as { cardId: string; pinnedAt: string } & Partial<PinnedAnalysisLayer>;
  if (!body?.cardId || !body?.pinnedAt) {
    return NextResponse.json({ error: "cardId+pinnedAt required" }, { status: 400 });
  }

  const { sb, user, role } = await assertMember(projectId);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const existing = await readLayers(sb, user.id, projectId);
  const updated = existing.map((l) =>
    l.cardId === body.cardId && l.pinnedAt === body.pinnedAt
      ? {
          ...l,
          ...(body.visible !== undefined && { visible: body.visible }),
          ...(body.layerName !== undefined && { layerName: body.layerName }),
          ...(body.cachedResult !== undefined && { cachedResult: body.cachedResult, cachedAt: new Date().toISOString() }),
        }
      : l,
  );
  const { error } = await writeLayers(sb, user.id, projectId, updated);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ layers: updated });
}
