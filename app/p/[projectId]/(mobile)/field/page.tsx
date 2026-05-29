import { getProjectForUser } from "@/lib/queries/project";
import { getStatusBreakdown, getMatchStatusFeatures } from "@/lib/queries/points";
import { listChatMessages, listProjectMembers } from "@/lib/queries/chat";
import { createServerSupabase } from "@/lib/supabase/server";
import { MobileFieldShell } from "@/components/mobile/field-shell";
import { notFound } from "next/navigation";

/**
 * Mobile field page. Loads ONLY field points (no R1) and strips
 * match_status from every feature so the surveyor never sees the
 * M1/F1 distinction — per project_fieldsurvey_mobile_scope memory.
 */
export default async function MobileFieldPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const res = await getProjectForUser(projectId);
  if (!res) notFound();

  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();

  type ProfileRow = { email: string | null; display_name: string | null } | null;
  type MeRow = { role: string } | null;
  let currentUser: { email: string | null; displayName: string | null; role: string | null } | null = null;
  if (user) {
    const [{ data: profileRaw }, { data: meRaw }] = await Promise.all([
      sb.from("profiles").select("email,display_name").eq("id", user.id).returns<ProfileRow[]>().maybeSingle() as unknown as Promise<{ data: ProfileRow }>,
      sb.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle() as unknown as Promise<{ data: MeRow }>,
    ]);
    currentUser = {
      email: profileRaw?.email ?? user.email ?? null,
      displayName: profileRaw?.display_name ?? null,
      role: meRaw?.role ?? null,
    };
  }

  const [statuses, allFeatures, chatMembers, initialChat, settingsRow] = await Promise.all([
    getStatusBreakdown(projectId),
    getMatchStatusFeatures(projectId),
    listProjectMembers(projectId),
    listChatMessages(projectId, 200),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sb.from("project_settings") as any)
      .select("canvass_mode")
      .eq("project_id", projectId)
      .maybeSingle() as Promise<{ data: { canvass_mode: boolean } | null }>,
  ]);
  const canvassMode = Boolean(settingsRow.data?.canvass_mode);

  // Mobile scope: field points only (point_id is set on field rows; null on R1),
  // and strip match_status so the M1/F1 ring symbology doesn't render.
  const safeFeatures = allFeatures
    .filter((f) => f.point_id != null)
    .map((f) => ({ ...f, match_status: null }));

  // Personal stats: how many points the current user has placed
  let myToday = 0, myTotal = 0;
  if (user) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: mine } = await (sb.from("points") as any)
      .select("collected_at")
      .eq("project_id", projectId)
      .eq("collector_id", user.id) as { data: Array<{ collected_at: string }> | null };
    myTotal = mine?.length ?? 0;
    const todayStr = new Date().toISOString().slice(0, 10);
    myToday = (mine ?? []).filter((p) => p.collected_at.slice(0, 10) === todayStr).length;
  }

  return (
    <MobileFieldShell
      projectId={projectId}
      projectName={res.project.name}
      currentUserId={user?.id ?? null}
      currentUser={currentUser}
      center={{ lat: res.project.center_lat, lon: res.project.center_lon, zoom: res.project.default_zoom ?? 14 }}
      statuses={statuses.map((s) => ({ id: s.id, label: s.label, color: s.color, icon: s.icon ?? null, count: s.count, pct: s.pct }))}
      chatMembers={chatMembers}
      initialChat={initialChat}
      features={safeFeatures}
      myStats={{ today: myToday, total: myTotal }}
      canvassMode={canvassMode}
    />
  );
}
