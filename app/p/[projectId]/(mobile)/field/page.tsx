import { getProjectForUser } from "@/lib/queries/project";
import { getStatusBreakdown } from "@/lib/queries/points";
import { MobileFieldShell } from "@/components/mobile/field-shell";
import { notFound } from "next/navigation";

/**
 * Mobile field map. Surveyor-facing only — no survey-response data.
 * Ports keystone_field_web/index.html into Next.js. Detailed bottom-sheet
 * and offline outbox arrive in the next slice; this page wires the map
 * + status filter chips + FAB.
 */
export default async function MobileFieldPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const res = await getProjectForUser(projectId);
  if (!res) notFound();

  const statuses = await getStatusBreakdown(projectId);

  return (
    <MobileFieldShell
      projectId={projectId}
      projectName={res.project.name}
      center={{ lat: res.project.center_lat, lon: res.project.center_lon, zoom: res.project.default_zoom ?? 14 }}
      statuses={statuses.map((s) => ({ id: s.id, label: s.label, color: s.color, count: s.count, pct: s.pct }))}
    />
  );
}
