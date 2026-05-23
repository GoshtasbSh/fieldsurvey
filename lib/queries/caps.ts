import { createServerSupabase } from "@/lib/supabase/server";

export type CapStatus = {
  points_count: number;
  max_points_per_project: number;
  pending_invites: number;
  max_pending_invites: number;
  warn_at_pct: number;
};

/** Per-project usage vs cap (for the soft-cap warning banner). */
export async function getProjectCaps(projectId: string): Promise<CapStatus | null> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("v_project_caps") as any)
    .select("points_count, max_points_per_project, pending_invites, max_pending_invites, warn_at_pct")
    .eq("project_id", projectId)
    .maybeSingle();
  return (data ?? null) as CapStatus | null;
}
