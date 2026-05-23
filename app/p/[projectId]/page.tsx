import { redirect } from "next/navigation";
import { detectDeviceServer } from "@/lib/device";

/**
 * Device-aware entry for a project. Mobile → /field, desktop → /map.
 */
export default async function ProjectIndex({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const device = await detectDeviceServer();
  redirect(`/p/${projectId}/${device === "mobile" ? "field" : "map"}`);
}
