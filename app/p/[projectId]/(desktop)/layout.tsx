import { getProjectForUser } from "@/lib/queries/project";

/**
 * Desktop shell — top bar + grid layout. The actual interactive shell
 * (top bar, left rail, right rail) is composed inside the map page because
 * its state is purely client-side. This layout sits between the auth gate
 * (../layout.tsx) and the page.
 *
 * Note: We do NOT redirect mobile users away here — the parent route
 * `app/p/[projectId]/page.tsx` already does device-based routing.
 */
export default async function DesktopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  // Touch the project to ensure access (auth gate is in parent layout)
  await getProjectForUser(projectId);
  return <div className="flex h-screen flex-col overflow-hidden bg-[var(--shell-base)] text-[var(--shell-text)]">{children}</div>;
}
