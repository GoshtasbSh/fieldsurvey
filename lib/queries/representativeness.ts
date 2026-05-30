import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Row shape for `project_demographics_schema` (migration 015) — admin
 * declares which raw_data keys in survey_responses are stratifiers and
 * how to join them to ACS categories.
 */
export type DemographicsSchemaRow = {
  project_id: string;
  raw_data_key: string;
  stratifier_type:
    | "age" | "race" | "sex" | "income"
    | "tenure" | "education" | "language" | "other";
  value_mapping: Record<string, string> | null;
  acs_join_method: "tract" | "block_group" | "none";
  updated_at: string;
};

/**
 * A40 — sample-vs-ACS schema check.
 *
 * Wave-1 doesn't compute the actual ACS comparison yet (no ACS data
 * ingested, no value_mapping UI built). This loader simply tells the
 * card whether any stratifiers are declared — the card renders an
 * empty-state panel when none are, and a placeholder mock when some
 * exist, until the full pipeline lands in a later wave.
 */
export async function getDemographicsSchema(
  projectId: string,
): Promise<DemographicsSchemaRow[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any)
    .from("project_demographics_schema")
    .select("*")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  return (data ?? []) as DemographicsSchemaRow[];
}
