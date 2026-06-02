import { assertSurfaceAllowed } from "@/lib/mobile/role-gate";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  MobileSurveyList,
  type MobileSurveyRow,
} from "@/components/mobile/survey/survey-list";

/**
 * Mobile Survey tab — list of imported survey_responses. Admin sees the
 * "Edit ›" affordance on each row (per-row edit page is a follow-up);
 * member sees the same list, read-only.
 *
 * raw_data is JSONB on the server and can contain anything the importer
 * shipped. We pull out the three fields we care to surface (status,
 * respondent name, date) defensively — anything missing falls back to
 * the address or external id.
 */
export default async function MobileSurveyPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const role = await assertSurfaceAllowed(projectId, "survey");

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("survey_responses") as any)
    .select(
      "id, point_id, raw_data, address_used, geocoded_lat, geocoded_lon, match_distance_m, matched_at, imported_at, external_id",
    )
    .eq("project_id", projectId)
    .order("imported_at", { ascending: false })
    .limit(2000);

  const responses: MobileSurveyRow[] = (data ?? []).map(
    (r: {
      id: string;
      point_id: string | null;
      raw_data: Record<string, unknown> | null;
      address_used: string | null;
      geocoded_lat: number | null;
      geocoded_lon: number | null;
      match_distance_m: number | null;
      matched_at: string | null;
      imported_at: string;
      external_id: string | null;
    }) => ({
      id: r.id,
      point_id: r.point_id,
      address_used: r.address_used,
      geocoded_lat: r.geocoded_lat,
      geocoded_lon: r.geocoded_lon,
      match_distance_m: r.match_distance_m,
      matched_at: r.matched_at,
      imported_at: r.imported_at,
      external_id: r.external_id,
      preview: extractPreview(r.raw_data),
    }),
  );

  return <MobileSurveyList role={role} responses={responses} />;
}

function extractPreview(raw: Record<string, unknown> | null) {
  if (!raw) return {};
  const out: { status?: string; respondent?: string; date?: string } = {};
  for (const key of Object.keys(raw)) {
    const v = raw[key];
    if (typeof v !== "string") continue;
    const k = key.toLowerCase();
    if (!out.status && /(status|outcome|result)/.test(k)) out.status = v;
    if (!out.respondent && /(name|resident|respondent|household)/.test(k)) out.respondent = v;
    if (!out.date && /(date|visit|collected)/.test(k)) out.date = v;
  }
  return out;
}
