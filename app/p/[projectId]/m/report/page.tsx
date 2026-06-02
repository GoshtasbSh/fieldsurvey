import { assertSurfaceAllowed } from "@/lib/mobile/role-gate";
import { GuestReportForm } from "@/components/mobile/report/report-form";

/**
 * Mobile Report tab — guest-only. Renders the report form.
 * assertSurfaceAllowed enforces guest exclusivity (admin/member → 404).
 */
export default async function MobileReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await assertSurfaceAllowed(projectId, "report");
  return <GuestReportForm projectId={projectId} />;
}
