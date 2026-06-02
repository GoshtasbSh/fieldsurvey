import { redirect } from "next/navigation";
import { getProjectForUser } from "@/lib/queries/project";
import { detectDeviceServer } from "@/lib/device";

/**
 * Desktop shell — top bar + grid layout. The actual interactive shell
 * (top bar, left rail, right rail) is composed inside the map page because
 * its state is purely client-side. This layout sits between the auth gate
 * (../layout.tsx) and the page.
 *
 * Device guard: middleware redirects mobile users to /p/[id]/m/<surface>
 * before they reach here. This layout re-runs the check as a defense in
 * depth — a client-side navigation that bypassed middleware, or a
 * misconfigured matcher, would otherwise serve the desktop shell on a
 * phone (the original "mobile shows desktop dashboard" bug). Cost is one
 * cookie/header read.
 */
export default async function DesktopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const device = await detectDeviceServer();
  if (device === "mobile") {
    // Middleware is the authoritative source of surface-aware redirects
    // (see lib/mobile/surface-map.ts:targetForDevice). This layout guard
    // is a defense-in-depth fallback for the rare case where a request
    // bypasses the middleware matcher. We deliberately land on /m/map
    // (the mobile shell's "home") rather than try to recover the exact
    // surface, because the layout has no visibility into the child page's
    // URL segment and an incorrect guess would be worse than a coarse
    // fallback. If you see users landing here often, fix middleware
    // coverage instead of trying to recover the surface here.
    redirect(`/p/${projectId}/m/map`);
  }
  // Touch the project to ensure access (auth gate is in parent layout)
  await getProjectForUser(projectId);
  return <div className="flex h-screen flex-col overflow-hidden bg-[var(--shell-base)] text-[var(--shell-text)]">{children}</div>;
}
