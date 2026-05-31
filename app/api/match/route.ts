import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * POST /api/match?project_id=...  — admin-only.
 * Auth gate in front of the Python serverless matcher at /api/py/match-responses.
 */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project_id");
  const addressSuffix = (url.searchParams.get("address_suffix") || "").trim();
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: projectId });
  if (role !== "owner" && role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // If the caller passed a fresh confirmed suffix (e.g. the Re-run matching
  // button after a re-prompt), persist it before kicking the matcher. The
  // matcher itself ALSO reads from project_settings, but persisting here
  // means a future page load shows the right pre-fill value.
  if (addressSuffix) {
    await sbAny
      .from("project_settings")
      .update({ geocode_address_suffix: addressSuffix })
      .eq("project_id", projectId);
  }

  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return NextResponse.json({ error: "INTERNAL_API_SECRET not configured" }, { status: 500 });
  const pyUrl = new URL("/api/py/match_responses", req.url);
  pyUrl.searchParams.set("project_id", projectId);
  if (addressSuffix) pyUrl.searchParams.set("address_suffix", addressSuffix);
  const r = await fetch(pyUrl, { method: "POST", headers: { "X-Internal-Secret": secret } });
  const body = await r.text();
  return new NextResponse(body, { status: r.status, headers: { "content-type": "application/json" } });
}
