import { createServerSupabase } from "@/lib/supabase/server";
import { readGuestSession } from "@/lib/auth/guest-session";

export type ProjectRole = "admin" | "member" | "guest";

/**
 * Resolve the caller's role for a given project on the mobile shell.
 *
 * Order:
 *   1. Valid fs_guest cookie whose projectId matches → "guest"
 *   2. Supabase user with a project_members row → "admin" if role==='admin',
 *      else "member" (coerces 'editor', 'viewer', etc. to 'member')
 *   3. Anything else → null (caller redirects to /sign-in or 404)
 *
 * The guest check is FIRST: a surveyor who logged in via day-code and then
 * happened to also have a stale Supabase session in the same browser must
 * still be treated as a guest — their fs_guest cookie carries the project
 * scope that the Supabase session does not.
 */
export async function getProjectRole(projectId: string): Promise<ProjectRole | null> {
  const guest = await readGuestSession();
  if (guest && guest.projectId === projectId) return "guest";

  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (sb.from("project_members") as any)
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle() as { data: { role: string } | null };

  if (!row) return null;
  return row.role === "admin" ? "admin" : "member";
}
