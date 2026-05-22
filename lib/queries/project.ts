import { createServerSupabase } from "@/lib/supabase/server";
import type { Tables } from "@/lib/db.types";

export async function getProjectForUser(projectId: string) {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: project } = await (sb.from("projects") as any)
    .select("id, name, description, owner_id, center_lat, center_lon, default_zoom, visibility, archived")
    .eq("id", projectId)
    .single() as { data: Tables<"projects"> | null };

  if (!project) return null;

  let role: string | null = null;
  if (user) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: m } = await (sb.from("project_members") as any)
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle() as { data: { role: string } | null };
    role = m?.role ?? null;
  }

  return { project, role };
}
