import { getProjectForUser } from "@/lib/queries/project";
import { getStatusBreakdown, getMatchStatusCounts, getMatchStatusFeatures } from "@/lib/queries/points";
import { getDailyActivity, getSurveyorLeaderboard, getCoverageMetrics, getHourlyDistribution, getDayOfWeekDistribution } from "@/lib/queries/analytics";
import { listChatMessages, listProjectMembers } from "@/lib/queries/chat";
import { getProjectCaps } from "@/lib/queries/caps";
import { readCachedBlobs } from "@/lib/cache/read";
import { getCanvassCompletion } from "@/lib/queries/universe";
import { createServerSupabase } from "@/lib/supabase/server";
import { MapShell } from "@/components/desktop/map-shell";
import { RealtimeWatcher } from "@/components/realtime-watcher";
import type { CanvassBlob } from "@/components/desktop/right-rail";
import { notFound } from "next/navigation";

export default async function DesktopMapPage({ params }: { params: Promise<{ projectId: string }> }) {
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

  const [
    statuses, matchCounts, features,
    daily, hourly, dow,
    surveyors, coverage,
    chatMembers, initialChat, caps,
    cacheBlobs,
  ] = await Promise.all([
    getStatusBreakdown(projectId),
    getMatchStatusCounts(projectId),
    getMatchStatusFeatures(projectId),
    getDailyActivity(projectId, 14),
    getHourlyDistribution(projectId),
    getDayOfWeekDistribution(projectId),
    getSurveyorLeaderboard(projectId),
    getCoverageMetrics(projectId),
    listProjectMembers(projectId),
    listChatMessages(projectId, 200),
    getProjectCaps(projectId),
    readCachedBlobs(projectId, ["pulse_blob", "analyze_blob", "match_status_blob", "canvass_blob"]),
  ]);

  // canvass_blob → prefer cached payload when fresh, else compute from
  // survey_universe directly. Disabled rows render no UI (right-rail checks
  // `enabled`), so we only invoke the raw query when canvass_mode is on.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settingsRow } = await (sb.from("project_settings") as any)
    .select("canvass_mode")
    .eq("project_id", projectId)
    .maybeSingle() as { data: { canvass_mode: boolean } | null };
  const canvassMode = Boolean(settingsRow?.canvass_mode);

  let canvass: CanvassBlob | null = null;
  if (canvassMode) {
    const cached = cacheBlobs.canvass_blob?.payload as CanvassBlob | undefined;
    if (cached && cached.enabled) {
      canvass = cached;
    } else {
      const summary = await getCanvassCompletion(projectId);
      canvass = {
        enabled: true,
        total: summary.total,
        visited: summary.visited,
        skipped: summary.skipped,
        pct: summary.pct,
        by_surveyor: [],
      };
    }
  }

  // Freshest cache timestamp across all blobs we read — used for the
  // "as of N minutes ago" badge in the topbar. null when no cache row exists.
  const cacheStamps = Object.values(cacheBlobs)
    .map((b) => b?.computed_at)
    .filter((s): s is string => typeof s === "string");
  const cachedAt = cacheStamps.length > 0
    ? cacheStamps.sort().reverse()[0]
    : null;

  const pointsTotal = (matchCounts.total_with_status ?? 0) + (matchCounts.r1_count ?? 0);
  const today = new Date().toISOString().slice(0, 10);
  const todayDelta = daily.find((d) => d.day === today)?.total ?? 0;

  return (
    <>
      <MapShell
        projectId={projectId}
        projectName={res.project.name}
        currentUserId={user?.id ?? null}
        currentUser={currentUser}
        center={{ lat: res.project.center_lat, lon: res.project.center_lon, zoom: res.project.default_zoom ?? 14 }}
        statuses={statuses.map((s) => ({ id: s.id, label: s.label, color: s.color, icon: s.icon ?? null, count: s.count, pct: s.pct }))}
        matchCounts={{ m1_count: matchCounts.m1_count ?? 0, f1_count: matchCounts.f1_count ?? 0, r1_count: matchCounts.r1_count ?? 0, total_with_status: matchCounts.total_with_status ?? 0 }}
        features={features}
        pointsTotal={pointsTotal}
        todayDelta={todayDelta}
        daily={daily}
        hourly={hourly}
        dow={dow}
        surveyors={surveyors}
        coverage={coverage}
        chatMembers={chatMembers}
        initialChat={initialChat}
        caps={caps}
        cachedAt={cachedAt}
        canvass={canvass}
      />
      <RealtimeWatcher projectId={projectId} />
    </>
  );
}
