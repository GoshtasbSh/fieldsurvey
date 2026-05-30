// Server-side queries for the A0 question colorizer:
// enumerate raw_data keys + return ColumnProfiles. Built per-project.

import { createServerSupabase } from "@/lib/supabase/server";
import type { ColumnProfile } from "@/lib/analyses/types";
import { buildColumnProfile } from "@/lib/colorize/auto-classify";

type RawRow = { raw_data: Record<string, unknown> | null };

/**
 * List all top-level keys in survey_responses.raw_data for a project,
 * with type-inferred ColumnProfiles. Cheap enough to call on Analyze-tab load
 * for projects with up to ~50k responses; for larger projects use the
 * import-time `survey_imports.column_profiles` cache instead.
 */
export async function getColumnProfiles(projectId: string): Promise<ColumnProfile[]> {
  const sb = await createServerSupabase();

  // 1. Try the import-time cache first (column_profiles jsonb in survey_imports)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: imports } = await (sb.from("survey_imports") as any)
    .select("column_profiles, imported_at")
    .eq("project_id", projectId)
    .order("imported_at", { ascending: false })
    .limit(1) as { data: Array<{ column_profiles: Record<string, ColumnProfile> | null }> | null };

  const cached = imports?.[0]?.column_profiles;
  if (cached && Object.keys(cached).length > 0) {
    return Object.values(cached);
  }

  // 2. Fallback: scan responses directly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (sb.from("survey_responses") as any)
    .select("raw_data")
    .eq("project_id", projectId)
    .limit(20000) as { data: RawRow[] | null };

  if (!rows || rows.length === 0) return [];

  // Gather all keys + their column-wise raw values
  const columns = new Map<string, unknown[]>();
  for (const r of rows) {
    if (!r.raw_data) continue;
    for (const [k, v] of Object.entries(r.raw_data)) {
      if (!columns.has(k)) columns.set(k, []);
      columns.get(k)!.push(v);
    }
  }

  const profiles: ColumnProfile[] = [];
  for (const [k, values] of columns.entries()) {
    profiles.push(buildColumnProfile(k, values));
  }
  return profiles.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Fetch the column profile for ONE key, plus all values of that key per
 * response_id. Used at render time by the A0 colorizer (small payload).
 */
export async function getColumnValuesById(
  projectId: string,
  key: string,
): Promise<{ profile: ColumnProfile | null; valuesByResponseId: Record<string, unknown> }> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("survey_responses") as any)
    .select("id, raw_data")
    .eq("project_id", projectId) as { data: Array<{ id: string; raw_data: Record<string, unknown> | null }> | null };

  if (!data) return { profile: null, valuesByResponseId: {} };

  const valuesByResponseId: Record<string, unknown> = {};
  const all: unknown[] = [];
  for (const r of data) {
    const v = r.raw_data?.[key];
    valuesByResponseId[r.id] = v ?? null;
    all.push(v ?? null);
  }
  const profile = buildColumnProfile(key, all);
  return { profile, valuesByResponseId };
}
