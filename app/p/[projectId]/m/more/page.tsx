import { assertSurfaceAllowed } from "@/lib/mobile/role-gate";
import { MobileMoreGrid } from "@/components/mobile/more/more-grid";

export default async function MobileMorePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await assertSurfaceAllowed(projectId, "more");
  return <MobileMoreGrid projectId={projectId} />;
}
