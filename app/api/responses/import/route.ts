import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { z } from "zod";

export const maxDuration = 300;

const ImportBody = z.object({
  project_id: z.string().uuid(),
  filename: z.string().min(1).max(200),
  address_column: z.string().min(1),
  external_id_column: z.string().nullable().optional(),
  // City/state/ZIP appended to every address before geocoding. Required
  // because the U.S. Census one-line geocoder cannot resolve street-only
  // inputs (e.g. "Harvard Avenue" exists in every state). The wizard
  // prompts and confirms this on every run — never silent.
  geocode_address_suffix: z.string().min(2).max(120),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).min(1).max(20000),
  source: z.enum(["qualtrics_csv", "google_forms_csv", "manual"]).default("qualtrics_csv"),
});

type MatcherSummary = {
  geocoded: number;
  matched_now: number;
  m1_count: number;
  f1_count: number;
  r1_count: number;
};

export async function POST(req: NextRequest) {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = ImportBody.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const body = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any;
  const { data: role } = await sbAny.rpc("project_role", { p_project: body.project_id });
  if (role !== "owner" && role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    return NextResponse.json({
      error:
        "Matcher is not configured: INTERNAL_API_SECRET is missing in this environment. " +
        "Rows would be inserted but never geocoded, so the import is refused.",
    }, { status: 500 });
  }

  const { data: imp } = await sbAny
    .from("survey_imports")
    .insert({
      project_id: body.project_id,
      filename: body.filename,
      row_count: body.rows.length,
      address_column: body.address_column,
      external_id_column: body.external_id_column ?? null,
      status: "processing",
      created_by: user.id,
    })
    .select("id")
    .single();

  let blankExternalIds = 0;
  const rowsToInsert = body.rows.map((r) => {
    let externalId: string | null = null;
    if (body.external_id_column) {
      const raw = String(r[body.external_id_column] ?? "").trim();
      if (!raw) blankExternalIds += 1;
      externalId = raw || null;
    }
    return {
      project_id: body.project_id,
      source: body.source,
      raw_data: r,
      address_used: String(r[body.address_column] ?? "").trim() || null,
      external_id: externalId,
      imported_by: user.id,
    };
  });
  if (body.external_id_column && blankExternalIds > 0) {
    await sbAny
      .from("survey_imports")
      .update({
        status: "failed",
        error_message: `${blankExternalIds} rows have an empty value in the "${body.external_id_column}" column`,
        completed_at: new Date().toISOString(),
      })
      .eq("id", imp?.id);
    return NextResponse.json({
      error: `${blankExternalIds} rows have an empty value in the "${body.external_id_column}" column. Pick a different column or fix the CSV.`,
    }, { status: 400 });
  }

  let inserted = 0;
  const chunk = 500;
  for (let i = 0; i < rowsToInsert.length; i += chunk) {
    const slice = rowsToInsert.slice(i, i + chunk);
    const { error } = await sbAny
      .from("survey_responses")
      .upsert(slice, { onConflict: "project_id,external_id", ignoreDuplicates: true });
    if (error) {
      await sbAny.from("survey_imports").update({
        status: "failed",
        error_message: error.message,
        completed_at: new Date().toISOString(),
      }).eq("id", imp?.id);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    inserted += slice.length;
  }

  const suffix = body.geocode_address_suffix.trim();
  await sbAny.from("project_settings").update({
    response_address_column: body.address_column,
    external_id_column: body.external_id_column ?? null,
    // Save the user's confirmed suffix so the next import pre-fills with it.
    // The wizard still re-prompts every time — this is just the default.
    geocode_address_suffix: suffix,
  }).eq("project_id", body.project_id);

  // Drive the matcher synchronously: the user is waiting on the wizard's
  // running state, and the rows on the map only appear after geocoding lands.
  // Previously this was a `void fetch(...)` fire-and-forget, which the
  // serverless runtime canceled on response — so the matcher never ran and
  // 100% of imported responses stayed ungeocoded.
  const pyUrl = new URL("/api/py/match_responses", req.url);
  pyUrl.searchParams.set("project_id", body.project_id);
  pyUrl.searchParams.set("address_suffix", suffix);

  let matcher: MatcherSummary | null = null;
  let matcherError: string | null = null;
  try {
    const r = await fetch(pyUrl, {
      method: "POST",
      headers: { "X-Internal-Secret": secret },
    });
    const text = await r.text();
    if (!r.ok) {
      matcherError = `matcher returned ${r.status}: ${text.slice(0, 500)}`;
    } else {
      try {
        matcher = JSON.parse(text) as MatcherSummary;
      } catch {
        matcherError = `matcher returned non-JSON: ${text.slice(0, 200)}`;
      }
    }
  } catch (e) {
    matcherError = e instanceof Error ? e.message : String(e);
  }

  await sbAny.from("survey_imports").update({
    status: matcherError ? "failed" : "completed",
    error_message: matcherError,
    matched_count: matcher?.m1_count ?? 0,
    field_only_count: matcher?.f1_count ?? 0,
    response_only_count: matcher?.r1_count ?? 0,
    completed_at: new Date().toISOString(),
  }).eq("id", imp?.id);

  return NextResponse.json({
    import_id: imp?.id,
    inserted,
    matcher,
    matcher_error: matcherError,
  });
}
