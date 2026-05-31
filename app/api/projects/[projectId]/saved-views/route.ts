// POST /api/projects/[projectId]/saved-views
// Admin-only: upsert a saved view (used by Catalog drawer "Save to view" footer).
//
// GET /api/projects/[projectId]/saved-views
// Returns the list of views visible to the current viewer.

import { NextResponse } from "next/server";
import { listSavedViews, upsertSavedView } from "@/lib/queries/saved-views";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  try {
    // Role resolution is enforced server-side by RLS; we default to 'member'
    // here for filtering — RLS will reject anything the user shouldn't see.
    const views = await listSavedViews(projectId, "member");
    return NextResponse.json({ views });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  let body: { name?: string; cards?: string[]; role_gate?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.name || !Array.isArray(body.cards)) {
    return NextResponse.json({ error: "name + cards[] required" }, { status: 400 });
  }
  try {
    const view = await upsertSavedView({
      project_id: projectId,
      name: body.name,
      cards: body.cards,
      role_gate: (body.role_gate as "admin" | "member" | "guest" | "surveyor") ?? "member",
      description: body.description,
    });
    return NextResponse.json({ view });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
