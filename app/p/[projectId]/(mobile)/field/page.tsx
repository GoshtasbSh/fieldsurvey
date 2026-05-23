import { getProjectForUser } from "@/lib/queries/project";
import { getStatusBreakdown } from "@/lib/queries/points";
import { listChatMessages, listProjectMembers } from "@/lib/queries/chat";
import { createServerSupabase } from "@/lib/supabase/server";
import { MobileFieldShell } from "@/components/mobile/field-shell";
import { notFound } from "next/navigation";

export default async function MobileFieldPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const res = await getProjectForUser(projectId);
  if (!res) notFound();

  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();

  const [statuses, chatMembers, initialChat] = await Promise.all([
    getStatusBreakdown(projectId),
    listProjectMembers(projectId),
    listChatMessages(projectId, 200),
  ]);

  return (
    <MobileFieldShell
      projectId={projectId}
      projectName={res.project.name}
      currentUserId={user?.id ?? null}
      center={{ lat: res.project.center_lat, lon: res.project.center_lon, zoom: res.project.default_zoom ?? 14 }}
      statuses={statuses.map((s) => ({ id: s.id, label: s.label, color: s.color, count: s.count, pct: s.pct }))}
      chatMembers={chatMembers}
      initialChat={initialChat}
    />
  );
}
