import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { z } from "zod";
import { createHash } from "node:crypto";

export const maxDuration = 300;

const ImportBody = z.object({
  project_id: z.string().uuid(),
  filename: z.string().min(1).max(200),
  address_column: z.string().min(1),
  external_id_column: z.string().nullable().optional(),
  // Which raw_data key carries the canvassing status for each row. Drives
  // R1 marker color on the map. Optional — if null, R1 markers fall back
  // to the default purple.
  response_status_column: z.string().nullable().optional(),
  // City/state/ZIP appended to every address before geocoding. Required
  // because the U.S. Census one-line geocoder cannot resolve street-only
  // inputs (e.g. "Harvard Avenue" exists in every state). The wizard
  // pre-fills with the project's last-used value but the user always
  // confirms — never silent.
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

type CanonicalScalar = string | number | boolean | null;
type CanonicalValue = CanonicalScalar | CanonicalValue[] | { [k: string]: CanonicalValue };

// Stable JSON: sort keys recursively so two rows with the same fields in
// different orders hash to the same value.
function canonicalize(value: unknown): CanonicalValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const obj: { [k: string]: CanonicalValue } = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      obj[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return obj;
  }
  return null;
}

function rowContentHash(projectId: string, address: string | null, raw: unknown): string {
  const payload = JSON.stringify([projectId, address ?? "", canonicalize(raw)]);
  return createHash("sha256").update(payload).digest("hex");
}

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

  const statusColumn = (body.response_status_column ?? "").trim() || null;

  const { data: imp } = await sbAny
    .from("survey_imports")
    .insert({
      project_id: body.project_id,
      filename: body.filename,
      row_count: body.rows.length,
      address_column: body.address_column,
      external_id_column: body.external_id_column ?? null,
      status_column: statusColumn,
      status: "processing",
      processing_step: "inserting",
      processing_done: 0,
      processing_total: body.rows.length,
      processing_at: new Date().toISOString(),
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
    const address = String(r[body.address_column] ?? "").trim() || null;
    return {
      project_id: body.project_id,
      source: body.source,
      raw_data: r,
      address_used: address,
      external_id: externalId,
      // Always compute content_hash so the unique partial index catches
      // re-imports of the same CSV when no external_id is picked.
      content_hash: rowContentHash(body.project_id, address, r),
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

  // Conflict target: if the user picked an external_id column, that's the
  // dedup key. Otherwise fall back to content_hash so re-importing the same
  // CSV is a no-op instead of doubling the table.
  const onConflict = body.external_id_column
    ? "project_id,external_id"
    : "project_id,content_hash";

  let attempted = 0;
  const chunk = 500;
  for (let i = 0; i < rowsToInsert.length; i += chunk) {
    const slice = rowsToInsert.slice(i, i + chunk);
    const { error } = await sbAny
      .from("survey_responses")
      .upsert(slice, { onConflict, ignoreDuplicates: true });
    if (error) {
      await sbAny.from("survey_imports").update({
        status: "failed",
        error_message: error.message,
        completed_at: new Date().toISOString(),
      }).eq("id", imp?.id);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    attempted += slice.length;
  }

  // Count how many of the upserted hashes actually exist for this project,
  // so we can show the user how many rows were new vs deduped.
  const hashes = rowsToInsert.map((r) => r.content_hash);
  const { count: existsCount } = await sbAny
    .from("survey_responses")
    .select("id", { count: "exact", head: true })
    .eq("project_id", body.project_id)
    .in("content_hash", hashes);
  // Pre-existing rows that match these hashes were already in the DB before
  // this import; the difference between attempted and (rows that now exist
  // from this CSV) is dedup-skipped or pre-existing. We surface both.
  const present = existsCount ?? 0;

  const suffix = body.geocode_address_suffix.trim();
  await sbAny.from("project_settings").update({
    response_address_column: body.address_column,
    external_id_column: body.external_id_column ?? null,
    response_status_column: statusColumn,
    geocode_address_suffix: suffix,
  }).eq("project_id", body.project_id);

  const pyUrl = new URL("/api/py/match_responses", req.url);
  pyUrl.searchParams.set("project_id", body.project_id);
  pyUrl.searchParams.set("address_suffix", suffix);
  if (imp?.id) pyUrl.searchParams.set("import_id", imp.id);

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
    processing_step: matcherError ? "failed" : "done",
    processing_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  }).eq("id", imp?.id);

  return NextResponse.json({
    import_id: imp?.id,
    attempted,
    present_after_import: present,
    matcher,
    matcher_error: matcherError,
  });
}
