import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * GET /api/projects/[projectId]/feature-detail?point_id=...
 *                                              &response_id=...
 *
 * Returns the full detail for the clicked map feature:
 *   - point — the public.points row (with status join) if point_id given
 *   - responses — every matched survey_response row (raw_data + headers)
 *   - parcel — parcel info if either side has parcel_id
 *
 * Mirrors Keystone's tabbed popup data shape so the client can render
 * Overview / Survey answers / Parcel without further round-trips.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const url = new URL(req.url);
  const pointId = url.searchParams.get("point_id");
  const responseId = url.searchParams.get("response_id");
  if (!pointId && !responseId) {
    return NextResponse.json({ error: "point_id or response_id required" }, { status: 400 });
  }

  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: projectId });
  if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Resolve the point (either directly or via the matched response).
  let point = null as null | Record<string, unknown>;
  if (pointId) {
    const { data } = await sbAny
      .from("points")
      .select("id, project_id, status_id, lat, lon, accuracy_m, address, notes, collected_at, collector_id, source, geocode_source, parcel_id, matched_response_id, project_statuses!inner(label, color, icon), profiles(display_name,email)")
      .eq("project_id", projectId)
      .eq("id", pointId)
      .maybeSingle();
    point = data ?? null;
  } else if (responseId) {
    const { data } = await sbAny
      .from("survey_responses")
      .select("point_id")
      .eq("project_id", projectId)
      .eq("id", responseId)
      .maybeSingle();
    if (data?.point_id) {
      const { data: p } = await sbAny
        .from("points")
        .select("id, project_id, status_id, lat, lon, accuracy_m, address, notes, collected_at, collector_id, source, geocode_source, parcel_id, matched_response_id, project_statuses!inner(label, color, icon), profiles(display_name,email)")
        .eq("project_id", projectId)
        .eq("id", data.point_id)
        .maybeSingle();
      point = p ?? null;
    }
  }

  // All matched responses for this point + the R1 standalone (if response_id only).
  let responses: Array<Record<string, unknown>> = [];
  if (point?.id) {
    const { data } = await sbAny
      .from("survey_responses")
      .select("id, source, raw_data, address_used, geocoded_lat, geocoded_lon, geocode_source, parcel_id, imported_at, external_id, match_distance_m, matched_at")
      .eq("project_id", projectId)
      .eq("point_id", point.id)
      .order("imported_at", { ascending: false });
    responses = data ?? [];
  } else if (responseId) {
    const { data } = await sbAny
      .from("survey_responses")
      .select("id, source, raw_data, address_used, geocoded_lat, geocoded_lon, geocode_source, parcel_id, imported_at, external_id, match_distance_m, matched_at")
      .eq("project_id", projectId)
      .eq("id", responseId)
      .maybeSingle();
    if (data) responses = [data];
  }

  // Parcel info — use whichever side has parcel_id (point takes precedence).
  const parcelId = (point?.parcel_id as string | undefined)
    ?? (responses.find((r) => r.parcel_id)?.parcel_id as string | undefined)
    ?? null;
  let parcel = null as null | Record<string, unknown>;
  if (parcelId) {
    const { data } = await sbAny
      .from("parcels")
      .select("id, parcel_apn, address, county, source")
      .eq("id", parcelId)
      .maybeSingle();
    parcel = data ?? null;
  }

  return NextResponse.json({ point, responses, parcel }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
