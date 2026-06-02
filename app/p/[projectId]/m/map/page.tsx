import { assertSurfaceAllowed } from "@/lib/mobile/role-gate";
import { createServerSupabase } from "@/lib/supabase/server";
import { getProjectForUser } from "@/lib/queries/project";
import { getStatusBreakdown, getMatchStatusFeatures } from "@/lib/queries/points";
import { listProjectBoundaries, boundariesAsFeatureCollection } from "@/lib/queries/parcels";
import { notFound } from "next/navigation";
import { MobileMapView } from "@/components/mobile/map/mobile-map-view";

/**
 * Mobile Map tab — full-bleed MapLibre with role-aware overlays. Same
 * server-side data pipeline the desktop /map uses (statuses, features,
 * boundaries), but:
 *
 *   - Field rows only (point_id != null) — no R1 response-only markers
 *   - match_status stripped from features so the M1/F1 rings don't render
 *     on mobile (per project_fieldsurvey_mobile_scope memo)
 *   - Per-user "mine" stats computed for the stat strip
 *
 * Renders INSIDE the (mobile)/m/layout shell — does not bring its own
 * topbar / tab bar.
 */
export default async function MobileMapPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const role = await assertSurfaceAllowed(projectId, "map");

  const res = await getProjectForUser(projectId);
  if (!res) notFound();
  const { project } = res;

  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();

  const [statuses, allFeatures, boundaryRows] = await Promise.all([
    getStatusBreakdown(projectId),
    getMatchStatusFeatures(projectId),
    listProjectBoundaries(projectId),
  ]);

  const safeFeatures = allFeatures
    .filter((f) => f.point_id != null)
    .map((f) => ({ ...f, match_status: null }));

  const boundaries =
    boundaryRows.length > 0 ? boundariesAsFeatureCollection(boundaryRows) : null;

  // Personal stats — only relevant for admin/member roles. Guest stays at 0/0.
  let myToday = 0;
  let myTotal = 0;
  if (user && role !== "guest") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: mine } = await (sb.from("points") as any)
      .select("collected_at")
      .eq("project_id", projectId)
      .eq("collector_id", user.id) as { data: Array<{ collected_at: string }> | null };
    myTotal = mine?.length ?? 0;
    const todayStr = new Date().toISOString().slice(0, 10);
    myToday = (mine ?? []).filter((p) => p.collected_at.slice(0, 10) === todayStr).length;
  }

  const totalPoints = statuses.reduce((sum, s) => sum + s.count, 0);
  const doneRow = statuses.find((s) =>
    /done|complete|completed|finished/i.test(s.label),
  );
  const doneCount = doneRow?.count ?? 0;

  // Today's delta — count of points collected_at today across the project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: todayCount } = await (sb.from("points") as any)
    .select("id", { head: true, count: "exact" })
    .eq("project_id", projectId)
    .gte("collected_at", new Date().toISOString().slice(0, 10));
  const todayDelta = todayCount ?? 0;

  return (
    <MobileMapView
      projectId={projectId}
      role={role}
      center={{
        lat: project.center_lat,
        lon: project.center_lon,
        zoom: project.default_zoom ?? 14,
      }}
      statuses={statuses.map((s) => ({
        id: s.id,
        label: s.label,
        color: s.color,
        count: s.count,
      }))}
      features={safeFeatures}
      boundaries={boundaries}
      myToday={myToday}
      myTotal={myTotal}
      totalPoints={totalPoints}
      todayDelta={todayDelta}
      doneCount={doneCount}
    />
  );
}
