import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { z } from "zod";
import { rowContentHash } from "@/lib/import/content-hash";
import { ensureCanonicalStatuses } from "@/lib/import/ensure-statuses";
import { categorizeStatus } from "@/lib/match/status-categorize";

export const maxDuration = 300;

const ImportBody = z.object({
  project_id: z.string().uuid(),
  filename: z.string().min(1).max(200),
  address_column: z.string().min(1),
  /** Required for field-canvass: every row gets a status_id, so the user
   * must tell us which CSV column encodes the canvassing outcome. */
  status_column: z.string().min(1),
  /** Optional — see /api/responses/import for the same semantics. */
  external_id_column: z.string().nullable().optional(),
  /** Required — Census needs more than a street to resolve a location. */
  geocode_address_suffix: z.string().min(2).max(120),
  replace_existing: z.boolean().default(true),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).min(1).max(20000),
});

type MatcherSummary = {
  geocoded: number;
  snapped_to_parcel: number;
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
      error: "Matcher is not configured (INTERNAL_API_SECRET missing). Field-canvass rows would never be geocoded, so the import is refused.",
    }, { status: 500 });
  }

  // Audit row (kind=field_canvass so the wizard's progress poller picks it
  // up from survey_imports the same way it does for survey-response runs).
  const { data: imp } = await sbAny
    .from("survey_imports")
    .insert({
      project_id: body.project_id,
      filename: body.filename,
      kind: "field_canvass",
      row_count: body.rows.length,
      address_column: body.address_column,
      external_id_column: body.external_id_column ?? null,
      status_column: body.status_column,
      status: "processing",
      processing_step: "inserting",
      processing_done: 0,
      processing_total: body.rows.length,
      processing_at: new Date().toISOString(),
      created_by: user.id,
    })
    .select("id")
    .single();

  // Make sure every canonical bucket we're about to use exists in
  // project_statuses (otherwise the FK on points.status_id fails).
  const rawStatusLabels = body.rows.map((r) => String(r[body.status_column] ?? ""));
  const labelToId = await ensureCanonicalStatuses(sbAny, body.project_id, rawStatusLabels);

  // Default status for rows that categorize to "Unknown" — find or default
  // to the project's `is_default` status.
  const { data: defaultStatus } = await sbAny
    .from("project_statuses")
    .select("id")
    .eq("project_id", body.project_id)
    .eq("is_default", true)
    .maybeSingle() as { data: { id: string } | null };

  const rowsToInsert: Array<{
    project_id: string;
    source: string;
    status_id: string;
    address: string | null;
    notes: string | null;
    content_hash: string;
    client_id: string;
    collected_at: string;
    is_offline_sync: boolean;
    collector_id: string;
  }> = [];

  let unresolvedStatus = 0;
  for (const r of body.rows) {
    const rawStatusText = String(r[body.status_column] ?? "").trim();
    const canonical = categorizeStatus(rawStatusText);
    let statusId = labelToId.get(canonical.toLowerCase());
    if (!statusId) {
      if (defaultStatus?.id) {
        statusId = defaultStatus.id;
        unresolvedStatus += 1;
      } else {
        await sbAny.from("survey_imports").update({
          status: "failed",
          error_message: `Could not resolve a status_id for row with status text "${rawStatusText}". Project has no default status and the canonical "${canonical}" bucket couldn't be created.`,
          completed_at: new Date().toISOString(),
        }).eq("id", imp?.id);
        return NextResponse.json({
          error: `Project has no default status and we couldn't auto-create the canonical "${canonical}" bucket. Add a status manually in Settings, mark it as default, and re-import.`,
        }, { status: 500 });
      }
    }
    const address = String(r[body.address_column] ?? "").trim() || null;
    rowsToInsert.push({
      project_id: body.project_id,
      source: "csv_import",
      status_id: statusId,
      address,
      notes: rawStatusText || null,
      content_hash: rowContentHash(body.project_id, address, r),
      client_id: crypto.randomUUID(),
      collected_at: new Date().toISOString(),
      is_offline_sync: false,
      collector_id: user.id,
    });
  }

  // Replace mode: wipe prior csv_import rows for this project so an updated
  // canvass log fully overwrites the prior version. Surveyors' mobile/
  // manual points are NEVER touched.
  let deleted = 0;
  if (body.replace_existing) {
    const { count } = await sbAny
      .from("points")
      .select("id", { count: "exact", head: true })
      .eq("project_id", body.project_id)
      .eq("source", "csv_import");
    deleted = count ?? 0;
    if (deleted > 0) {
      const { error: delErr } = await sbAny
        .from("points")
        .delete()
        .eq("project_id", body.project_id)
        .eq("source", "csv_import");
      if (delErr) {
        await sbAny.from("survey_imports").update({
          status: "failed",
          error_message: `replace-mode delete failed: ${delErr.message}`,
          completed_at: new Date().toISOString(),
        }).eq("id", imp?.id);
        return NextResponse.json({ error: `replace-mode delete failed: ${delErr.message}` }, { status: 500 });
      }
    }
  }

  let attempted = 0;
  const chunk = 500;
  for (let i = 0; i < rowsToInsert.length; i += chunk) {
    const slice = rowsToInsert.slice(i, i + chunk);
    const { error } = await sbAny
      .from("points")
      .upsert(slice, { onConflict: "project_id,content_hash", ignoreDuplicates: true });
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

  const hashes = rowsToInsert.map((r) => r.content_hash);
  const { count: existsCount } = await sbAny
    .from("points")
    .select("id", { count: "exact", head: true })
    .eq("project_id", body.project_id)
    .in("content_hash", hashes);
  const present = existsCount ?? 0;

  const suffix = body.geocode_address_suffix.trim();
  await sbAny.from("project_settings").update({
    geocode_address_suffix: suffix,
  }).eq("project_id", body.project_id);

  // Fire the matcher in field-canvass mode: geocode + parcel-snap each
  // un-geocoded point, then run the linker so any pre-existing R1
  // responses get auto-matched to the new field points.
  const pyUrl = new URL("/api/py/match_responses", req.url);
  pyUrl.searchParams.set("project_id", body.project_id);
  pyUrl.searchParams.set("address_suffix", suffix);
  pyUrl.searchParams.set("kind", "field_canvass");
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
    deleted_before_import: deleted,
    present_after_import: present,
    unresolved_status: unresolvedStatus,
    matcher,
    matcher_error: matcherError,
  });
}
