import { redirect } from "next/navigation";
import { detectDeviceServer } from "@/lib/device";

/**
 * Device-aware entry for a project. Mobile → /m/map (new mobile shell),
 * desktop → /map. Middleware also enforces device routing on sub-paths so
 * deep links land in the right shell even when this page never runs.
 */
export default async function ProjectIndex({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const device = await detectDeviceServer();
  redirect(
    device === "mobile" ? `/p/${projectId}/m/map` : `/p/${projectId}/map`,
  );
}
