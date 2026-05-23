import { getProjectForUser } from "@/lib/queries/project";
import { getStatusBreakdown, getMatchStatusCounts, getMatchStatusFeatures } from "@/lib/queries/points";
import { getDailyActivity, getSurveyorLeaderboard, getCoverageMetrics } from "@/lib/queries/analytics";
import { MapShell } from "@/components/desktop/map-shell";
import { RealtimeWatcher } from "@/components/realtime-watcher";
import { notFound } from "next/navigation";

export default async function DesktopMapPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const res = await getProjectForUser(projectId);
  if (!res) notFound();

  const [statuses, matchCounts, features, daily, surveyors, coverage] = await Promise.all([
    getStatusBreakdown(projectId),
    getMatchStatusCounts(projectId),
    getMatchStatusFeatures(projectId),
    getDailyActivity(projectId, 14),
    getSurveyorLeaderboard(projectId),
    getCoverageMetrics(projectId),
  ]);

  const pointsTotal = (matchCounts.total_with_status ?? 0) + (matchCounts.r1_count ?? 0);
  const today = new Date().toISOString().slice(0, 10);
  const todayDelta = daily.find((d) => d.day === today)?.total ?? 0;

  return (
    <>
      <MapShell
        projectId={projectId}
        projectName={res.project.name}
        center={{ lat: res.project.center_lat, lon: res.project.center_lon, zoom: res.project.default_zoom ?? 14 }}
        statuses={statuses.map((s) => ({ id: s.id, label: s.label, color: s.color, count: s.count, pct: s.pct }))}
        matchCounts={{
          m1_count: matchCounts.m1_count ?? 0,
          f1_count: matchCounts.f1_count ?? 0,
          r1_count: matchCounts.r1_count ?? 0,
          total_with_status: matchCounts.total_with_status ?? 0,
        }}
        features={features}
        pointsTotal={pointsTotal}
        todayDelta={todayDelta}
        daily={daily}
        surveyors={surveyors}
        coverage={coverage}
      />
      <RealtimeWatcher projectId={projectId} />
    </>
  );
}
