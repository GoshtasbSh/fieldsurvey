import { assertSurfaceAllowed } from "@/lib/mobile/role-gate";
import { getStatusBreakdown } from "@/lib/queries/points";
import { MobileAddPointPage } from "@/components/mobile/map/add-point-page";

/**
 * Mobile add-point full-screen page. Reached from the Map FAB. All three
 * roles can add (admin/member/guest) — the API layer handles the role-
 * specific write path (guest uses /api/points/guest with the fs_guest
 * cookie; member/admin use the standard signed-in RLS).
 */
export default async function MobileAddPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await assertSurfaceAllowed(projectId, "add");

  const statuses = await getStatusBreakdown(projectId);
  return (
    <MobileAddPointPage
      projectId={projectId}
      statuses={statuses.map((s) => ({
        id: s.id,
        label: s.label,
        color: s.color,
        icon: s.icon ?? null,
        count: s.count,
        pct: s.pct,
      }))}
    />
  );
}
