import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * GET /api/projects/[projectId]/import-progress[?import_id=...]
 *
 * Returns the live progress of the most recent (or specified) survey_imports
 * row so the import wizard can render a real progress bar while the Python
 * matcher chews through Census geocoding. The matcher writes processing_step
 * + processing_done / processing_total every ~10 rows.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const url = new URL(req.url);
  const importId = url.searchParams.get("import_id");

  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: projectId });
  if (role !== "owner" && role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let query = sbAny
    .from("survey_imports")
    .select("id,status,processing_step,processing_done,processing_total,processing_at,error_message,matched_count,field_only_count,response_only_count,row_count,completed_at")
    .eq("project_id", projectId);
  if (importId) {
    query = query.eq("id", importId);
  } else {
    query = query.order("created_at", { ascending: false }).limit(1);
  }
  const { data, error } = await query.maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "no import found" }, { status: 404 });
  return NextResponse.json(data, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
