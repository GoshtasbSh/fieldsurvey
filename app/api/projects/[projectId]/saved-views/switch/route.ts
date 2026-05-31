// POST /api/projects/[projectId]/saved-views/switch
// Persists the viewer's active Saved View into user_view_state.

import { NextResponse } from "next/server";
import { switchActiveView } from "@/lib/queries/saved-views";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  let body: { viewId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    await switchActiveView(projectId, body.viewId ?? null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
