// POST /api/projects/[projectId]/catalog/vote
// Records an idempotent upvote on a stub card for the current viewer.

import { NextResponse } from "next/server";
import { voteForStubCard } from "@/lib/queries/saved-views";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  let body: { cardId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.cardId) {
    return NextResponse.json({ error: "cardId required" }, { status: 400 });
  }
  try {
    await voteForStubCard(body.cardId, projectId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
