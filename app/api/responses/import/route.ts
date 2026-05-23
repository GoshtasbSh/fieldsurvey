import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { z } from "zod";

const ImportBody = z.object({
  project_id: z.string().uuid(),
  filename: z.string().min(1).max(200),
  address_column: z.string().min(1),
  external_id_column: z.string().nullable().optional(),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).min(1).max(20000),
  source: z.enum(["qualtrics_csv", "google_forms_csv", "manual"]).default("qualtrics_csv"),
});

/**
 * Bulk-insert imported survey responses for a project.
 * Records an audit row in survey_imports.
 * Does NOT trust the rows' own lat/lon — geocoding happens server-side via
 * the Python matcher when the user clicks "Run matching" (or auto-triggered
 * by this route at the end).
 */
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

  // Audit row
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

  // Insert responses in chunks
  const rowsToInsert = body.rows.map((r) => ({
    project_id: body.project_id,
    source: body.source,
    raw_data: r,
    address_used: String(r[body.address_column] ?? "").trim() || null,
    external_id: body.external_id_column ? String(r[body.external_id_column] ?? "").trim() || null : null,
    imported_by: user.id,
  }));

  let inserted = 0;
  const chunk = 500;
  for (let i = 0; i < rowsToInsert.length; i += chunk) {
    const slice = rowsToInsert.slice(i, i + chunk);
    const { error } = await sbAny.from("survey_responses").upsert(slice, { onConflict: "project_id,external_id", ignoreDuplicates: true });
    if (error) {
      await sbAny.from("survey_imports").update({ status: "failed", error_message: error.message, completed_at: new Date().toISOString() }).eq("id", imp?.id);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    inserted += slice.length;
  }

  // Persist the address-column choice for next time
  await sbAny.from("project_settings").update({
    response_address_column: body.address_column,
    external_id_column: body.external_id_column ?? null,
  }).eq("project_id", body.project_id);

  // Trigger the matcher (best-effort, async)
  try {
    const pyUrl = new URL("/api/py/match-responses", req.url);
    pyUrl.searchParams.set("project_id", body.project_id);
    void fetch(pyUrl, { method: "POST" });
  } catch { /* ignore */ }

  await sbAny.from("survey_imports").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", imp?.id);
  return NextResponse.json({ import_id: imp?.id, inserted });
}
