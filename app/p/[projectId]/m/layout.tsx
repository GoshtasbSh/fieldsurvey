import "./shell.css";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getProjectRole, type ProjectRole } from "@/lib/mobile/role-gate";
import { isSurfaceAllowed } from "@/lib/mobile/tabs";
import type { MobileSurface } from "@/lib/mobile/surface-map";
import { readGuestSession } from "@/lib/auth/guest-session";
import { MobileShellWrapper } from "@/components/mobile/shell/mobile-shell-wrapper";

/**
 * Mobile project shell — wraps every /p/[id]/m/<surface> page with the
 * bottom-tab + topbar + drawer chrome. Responsibilities:
 *
 *  1. Auth gate: no Supabase user and no fs_guest cookie → /sign-in
 *  2. Project + profile lookup for topbar + drawer
 *  3. Theme injection from fs_theme cookie
 *  4. Mounts MobileShellWrapper which registers the SW (only when in this shell)
 *
 * Role gate is per-page via assertSurfaceAllowed() so layouts (which can't
 * read the active child segment in Next.js 15) don't have to guess. See the
 * helper at the bottom of this file.
 */
export default async function MobileShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const role = await getProjectRole(projectId);
  if (!role) {
    redirect(`/sign-in?next=/p/${projectId}/m/map`);
  }

  const sb = await createServerSupabase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: project } = await (sb.from("projects") as any)
    .select("id, name")
    .eq("id", projectId)
    .single();
  if (!project) notFound();

  let displayName: string | null = null;
  let email: string | null = null;
  let initial = "?";

  if (role === "guest") {
    initial = "G";
    displayName = "Guest surveyor";
  } else {
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (user) {
      email = user.email ?? null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: profile } = await (sb.from("profiles") as any)
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();
      displayName = (profile?.display_name as string | null) ?? null;
      initial = (displayName ?? email ?? "?").charAt(0).toUpperCase();
    }
  }

  const guestExpiresAt =
    role === "guest" ? (await readGuestSession())?.expiresAt : undefined;

  const cookieStore = await cookies();
  const theme = (cookieStore.get("fs_theme")?.value === "light" ? "light" : "dark") as
    | "light"
    | "dark";

  return (
    <MobileShellWrapper
      theme={theme}
      projectId={projectId}
      projectName={project.name}
      role={role}
      user={{ displayName, email, initial }}
      guestExpiresAt={guestExpiresAt}
    >
      {children}
    </MobileShellWrapper>
  );
}

/**
 * Page-side surface assertion. Call at the top of every /m/<surface>/page.tsx
 * server component so a guest hitting /m/analysis (URL-guessed) gets 404
 * instead of a half-rendered admin screen.
 */
export async function assertSurfaceAllowed(
  projectId: string,
  surface: MobileSurface,
): Promise<ProjectRole> {
  const role = await getProjectRole(projectId);
  if (!role) redirect(`/sign-in?next=/p/${projectId}/m/${surface}`);
  if (!isSurfaceAllowed(role, surface)) notFound();
  return role;
}
