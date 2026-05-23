import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * POST /api/match?project_id=...  — admin-only.
 * Auth gate in front of the Python serverless matcher at /api/py/match-responses.
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: role } = await (sb as any).rpc("project_role", { p_project: projectId });
  if (role !== "owner" && role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Forward to the Python serverless
  const pyUrl = new URL("/api/py/match-responses", req.url);
  pyUrl.searchParams.set("project_id", projectId);
  const r = await fetch(pyUrl, { method: "POST" });
  const body = await r.text();
  return new NextResponse(body, { status: r.status, headers: { "content-type": "application/json" } });
}
