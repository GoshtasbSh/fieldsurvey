import { getProjectForUser } from "@/lib/queries/project";
import { getStatusBreakdown, getMatchStatusCounts, getMatchStatusFeatures } from "@/lib/queries/points";
import { getDailyActivity, getSurveyorLeaderboard, getCoverageMetrics, getHourlyDistribution, getDayOfWeekDistribution } from "@/lib/queries/analytics";
import { listChatMessages, listProjectMembers } from "@/lib/queries/chat";
import { getProjectCaps } from "@/lib/queries/caps";
import { readCachedBlobs } from "@/lib/cache/read";
import { getCanvassCompletion } from "@/lib/queries/universe";
import { listProjectBoundaries, boundariesAsFeatureCollection } from "@/lib/queries/parcels";
import { createServerSupabase } from "@/lib/supabase/server";
import { listSavedViews, getActiveView, type SavedView } from "@/lib/queries/saved-views";
import { MapShell } from "@/components/desktop/map-shell";
import { RealtimeWatcher } from "@/components/realtime-watcher";
import type {
  CanvassBlob,
  DailyBucket,
  CoverageMetrics,
} from "@/components/desktop/right-rail";
import type { MatchStatusCounts } from "@/lib/match/status";
import type { HourBucket, DowBucket } from "@/lib/queries/analytics";
import { notFound } from "next/navigation";

/**
 * Cache content-swap (M4 deferred → shipped in M6+).
 *
 * `pulse_blob` and `analyze_blob` are written by the refresh worker every
 * time the cache rolls forward. When the cached payload is fresh enough
 * we use it directly instead of running the raw queries; when stale (or
 * absent) we fall back to the raw values that already came back from the
 * parallel fetches above.
 *
 * 15 minutes is generous — the typical refresh cadence is a few minutes
 * and the badge in the topbar shows the actual age so the operator can
 * see when they're reading from the cache.
 */
const CACHE_FRESH_S = 15 * 60;

type PulseBlobPayload = {
  pointsTotal: number;
  todayDelta: number;
  matchCounts: MatchStatusCounts;
  daily: DailyBucket[];
};

type AnalyzeBlobPayload = {
  matchCounts: MatchStatusCounts;
  hourly: HourBucket[];
  dow: DowBucket[];
  coverage: CoverageMetrics;
};

function preferFresh<T>(
  blob: { payload: unknown; age_seconds: number } | undefined,
): T | null {
  if (!blob || blob.age_seconds >= CACHE_FRESH_S) return null;
  return blob.payload as T;
}

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
    getHourlyDistribution(projectId, "America/New_York"),
    getDayOfWeekDistribution(projectId),
    getSurveyorLeaderboard(projectId),
    getCoverageMetrics(projectId),
    listProjectMembers(projectId),
    listChatMessages(projectId, 200),
    getProjectCaps(projectId),
    readCachedBlobs(projectId, ["pulse_blob", "analyze_blob", "match_status_blob", "canvass_blob"]),
  ]);

  // M6 — boundary overlay. Empty FeatureCollection when project has none.
  const boundaryRows = await listProjectBoundaries(projectId);
  const boundaries = boundaryRows.length > 0
    ? boundariesAsFeatureCollection(boundaryRows)
    : null;

  // M7 — Saved Views + viewer's currently-active view. Role-filter happens
  // server-side (RLS gates admin-only views from non-admins).
  const viewerRole = (currentUser?.role ?? "member") as SavedView["role_gate"];
  const [savedViews, activeView] = await Promise.all([
    listSavedViews(projectId, viewerRole),
    getActiveView(projectId),
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

  // Cache content-swap. Pull fresh cached payloads; fall back to raw.
  // surveyors stays raw because the analyze_blob version lacks display names.
  const pulse = preferFresh<PulseBlobPayload>(cacheBlobs.pulse_blob);
  const analyze = preferFresh<AnalyzeBlobPayload>(cacheBlobs.analyze_blob);

  // POINTS card = field points only (M1 matched + F1 field-only). The
  // previous expression `total_with_status + r1_count` double-counted: the
  // view's total_with_status already includes M1 + F1 + R1, so adding r1
  // again produced 2*R1 + M1 + F1 (= 613 for the user with 1 F1 + 306 R1).
  // The Match Status card separately shows R1, so we don't want it folded
  // into POINTS.
  const rawPointsTotal = (matchCounts.m1_count ?? 0) + (matchCounts.f1_count ?? 0);
  const today = new Date().toISOString().slice(0, 10);
  const rawTodayDelta = daily.find((d) => d.day === today)?.total ?? 0;

  const usedPointsTotal = pulse?.pointsTotal ?? rawPointsTotal;
  const usedTodayDelta = pulse?.todayDelta ?? rawTodayDelta;
  const usedMatchCounts = pulse?.matchCounts ?? analyze?.matchCounts ?? matchCounts;
  const usedDaily = pulse?.daily ?? daily;
  const usedHourly = analyze?.hourly ?? hourly;
  const usedDow = analyze?.dow ?? dow;
  const usedCoverage = analyze?.coverage ?? coverage;

  return (
    <>
      <MapShell
        projectId={projectId}
        projectName={res.project.name}
        currentUserId={user?.id ?? null}
        currentUser={currentUser}
        center={{ lat: res.project.center_lat, lon: res.project.center_lon, zoom: res.project.default_zoom ?? 14 }}
        statuses={statuses.map((s) => ({ id: s.id, label: s.label, color: s.color, icon: s.icon ?? null, count: s.count, pct: s.pct }))}
        matchCounts={{
          m1_count: usedMatchCounts.m1_count ?? 0,
          f1_count: usedMatchCounts.f1_count ?? 0,
          r1_count: usedMatchCounts.r1_count ?? 0,
          total_with_status: usedMatchCounts.total_with_status ?? 0,
        }}
        features={features}
        pointsTotal={usedPointsTotal}
        todayDelta={usedTodayDelta}
        daily={usedDaily}
        hourly={usedHourly}
        dow={usedDow}
        surveyors={surveyors}
        coverage={usedCoverage}
        chatMembers={chatMembers}
        initialChat={initialChat}
        caps={caps}
        cachedAt={cachedAt}
        canvass={canvass}
        boundaries={boundaries}
        savedViews={savedViews.map((v) => ({
          id: v.id,
          name: v.name,
          cards: v.cards,
          description: v.description,
          role_gate: v.role_gate,
          is_default: v.is_default,
        }))}
        initialActiveViewId={activeView.view_id}
      />
      <RealtimeWatcher projectId={projectId} />
    </>
  );
}
