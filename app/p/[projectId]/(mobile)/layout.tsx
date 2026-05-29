import { redirect } from "next/navigation";
import { getProjectForUser } from "@/lib/queries/project";
import { canCollectMobile, type ProjectRole } from "@/lib/auth/role";
import { readGuestSession } from "@/lib/auth/guest-session";

/**
 * Mobile shell — field-collection only. NEVER imports survey-response
 * code (see project_fieldsurvey_mobile_scope in memory).
 *
 * Access ladder:
 *   1. Signed-in member with collect role → render the shell.
 *   2. Anonymous user holding a guest cookie scoped to THIS project → render
 *      the shell. The /api/points/guest route is the choke point for writes.
 *   3. Everyone else → /use-desktop explainer (or sign-in for anon non-guest).
 */
export default async function MobileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  // Guest fast-path — if a valid cookie binds this browser to *this* project,
  // skip the auth + role lookup entirely. Guests have no Supabase session.
  const guest = await readGuestSession();
  if (guest && guest.projectId === projectId) {
    return (
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--shell-base)] text-[var(--shell-text)]">
        {children}
      </div>
    );
  }

  const res = await getProjectForUser(projectId);
  const role = (res?.role ?? null) as ProjectRole;
  if (!canCollectMobile(role)) {
    redirect(`/use-desktop?next=/p/${projectId}/map`);
  }
  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--shell-base)] text-[var(--shell-text)]">
      {children}
    </div>
  );
}
