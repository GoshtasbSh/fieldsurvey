// GET /api/projects/[projectId]/columns/[key]
// Returns { profile, valuesByResponseId } for a single column — used by the
// A0 question colorizer to repaint map points.

import { NextResponse } from "next/server";
import { getColumnValuesById } from "@/lib/queries/columns";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; key: string }> },
) {
  const { projectId, key } = await params;
  try {
    const result = await getColumnValuesById(projectId, decodeURIComponent(key));
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
