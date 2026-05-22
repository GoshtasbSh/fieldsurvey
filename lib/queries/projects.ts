import { createServerSupabase } from "@/lib/supabase/server";
import type { Tables } from "@/lib/db.types";

type ProjectRow = Tables<"projects"> & {
  project_members: Array<{ role: string }>;
};

export async function listMyProjects(): Promise<{ owned: ProjectRow[]; shared: ProjectRow[] }> {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { owned: [], shared: [] };

  const { data } = await sb
    .from("projects")
    .select("id, name, description, owner_id, center_lat, center_lon, default_zoom, visibility, archived, created_at, updated_at, project_members!inner(role)")
    .eq("archived", false)
    .order("updated_at", { ascending: false })
    .returns<ProjectRow[]>();

  const rows = data ?? [];
  return {
    owned: rows.filter((r) => r.owner_id === user.id),
    shared: rows.filter((r) => r.owner_id !== user.id),
  };
}
