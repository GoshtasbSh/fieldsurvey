import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isMobileUserAgent } from "@/lib/device";

export default async function ProjectIndex({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const h = await headers();
  const ua = h.get("user-agent") || "";
  redirect(isMobileUserAgent(ua) ? `/p/${projectId}/field` : `/p/${projectId}/map`);
}
