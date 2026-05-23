import { createServerSupabase } from "@/lib/supabase/server";

export type ChatMessage = {
  id: string;
  project_id: string;
  author_id: string;
  body: string;
  mentions: string[];
  edited_at: string | null;
  created_at: string;
  author?: { display_name: string | null; email: string; avatar_url: string | null };
};

/** Most-recent N chat messages for a project, oldest-first. */
export async function listChatMessages(projectId: string, limit = 200): Promise<ChatMessage[]> {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("chat_messages") as any)
    .select("id, project_id, author_id, body, mentions, edited_at, created_at, profiles!chat_messages_author_id_fkey(display_name, email, avatar_url)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit) as { data: Array<ChatMessage & { profiles: ChatMessage["author"] }> | null };
  const rows = (data ?? []).map((r) => ({ ...r, author: r.profiles })).reverse();
  return rows;
}

/** Lightweight roster of project members (for @mention autocomplete + presence). */
export async function listProjectMembers(projectId: string) {
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from("project_members") as any)
    .select("user_id, role, profiles!project_members_user_id_fkey(display_name, email, avatar_url)")
    .eq("project_id", projectId) as { data: Array<{ user_id: string; role: string; profiles: { display_name: string | null; email: string; avatar_url: string | null } | null }> | null };
  return (data ?? []).map((r) => ({
    user_id: r.user_id,
    role: r.role,
    display_name: r.profiles?.display_name ?? r.profiles?.email?.split("@")[0] ?? "Member",
    email: r.profiles?.email ?? "",
    avatar_url: r.profiles?.avatar_url ?? null,
  }));
}
