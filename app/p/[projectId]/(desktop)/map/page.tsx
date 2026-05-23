import { getProjectForUser } from "@/lib/queries/project";
import { getStatusBreakdown, getMatchStatusCounts, getMatchStatusFeatures } from "@/lib/queries/points";
import { MapShell } from "@/components/desktop/map-shell";
import { notFound } from "next/navigation";

export default async function DesktopMapPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const res = await getProjectForUser(projectId);
  if (!res) notFound();

  const [statuses, matchCounts, features] = await Promise.all([
    getStatusBreakdown(projectId),
    getMatchStatusCounts(projectId),
    getMatchStatusFeatures(projectId),
  ]);

  const pointsTotal = matchCounts.total_with_status + matchCounts.r1_count;
  // todayDelta will come from a windowed query in the analytics slice
  const todayDelta = 0;

  return (
    <MapShell
      projectId={projectId}
      projectName={res.project.name}
      center={{ lat: res.project.center_lat, lon: res.project.center_lon, zoom: res.project.default_zoom ?? 14 }}
      statuses={statuses.map((s) => ({ id: s.id, label: s.label, color: s.color, count: s.count, pct: s.pct }))}
      matchCounts={matchCounts}
      features={features}
      pointsTotal={pointsTotal}
      todayDelta={todayDelta}
    />
  );
}
