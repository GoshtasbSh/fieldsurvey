// GET /api/projects/[projectId]/columns
// Returns the list of column profiles for the project (cached at import time,
// falls back to scanning survey_responses if missing).

import { NextResponse } from "next/server";
import { getColumnProfiles } from "@/lib/queries/columns";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  try {
    const profiles = await getColumnProfiles(projectId);
    return NextResponse.json({ profiles });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
