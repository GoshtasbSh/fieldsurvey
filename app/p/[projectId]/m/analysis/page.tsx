import { assertSurfaceAllowed } from "@/lib/mobile/role-gate";
import { getDailyActivity, getCoverageMetrics } from "@/lib/queries/analytics";
import { getStatusBreakdown } from "@/lib/queries/points";
import { createServerSupabase } from "@/lib/supabase/server";
import { MiniDashboard } from "@/components/mobile/analysis/mini-dashboard";

export default async function MobileAnalysisPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await assertSurfaceAllowed(projectId, "analysis");

  const [daily, coverage, statuses] = await Promise.all([
    getDailyActivity(projectId, 14),
    getCoverageMetrics(projectId),
    getStatusBreakdown(projectId),
  ]);

  const totalPoints = statuses.reduce((s, r) => s + r.count, 0);

  // Today's delta
  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: todayCount } = await (sb.from("points") as any)
    .select("id", { head: true, count: "exact" })
    .eq("project_id", projectId)
    .gte("collected_at", new Date().toISOString().slice(0, 10));

  return (
    <MiniDashboard
      totalPoints={totalPoints}
      todayDelta={todayCount ?? 0}
      coverage={coverage}
      daily={daily}
    />
  );
}
