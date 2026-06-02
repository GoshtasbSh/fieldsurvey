"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MobileTopbar } from "./mobile-topbar";
import { MobileTabbar } from "./mobile-tabbar";
import { MobileDrawer } from "./mobile-drawer";
import type { ProjectRole } from "@/lib/mobile/role-gate";
import type { MobileSurface } from "@/lib/mobile/surface-map";

type Props = {
  projectId: string;
  projectName: string;
  role: ProjectRole;
  activeSurface: MobileSurface;
  user: {
    displayName: string | null;
    email: string | null;
    initial: string;
  };
  guestExpiresAt?: string;
  liveOnline?: number;
  badges?: Partial<Record<MobileSurface, number>>;
  children: React.ReactNode;
};

/**
 * Outer mobile shell — composes topbar + tabbar + drawer around the page
 * content. Handles theme persistence, drawer state, and the global
 * "switch to desktop" / "sign out" actions so individual pages don't have
 * to re-wire them.
 *
 * Pages render INSIDE the main area; they should layout themselves with
 * height: 100% and not introduce their own top/bottom bars.
 */
export function MobileShell({
  projectId,
  projectName,
  role,
  activeSurface,
  user,
  guestExpiresAt,
  liveOnline,
  badges,
  children,
}: Props) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const onToggleTheme = useCallback(() => {
    const html = document.documentElement;
    const next = html.dataset.theme === "light" ? "dark" : "light";
    html.dataset.theme = next;
    const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
    document.cookie = `fs_theme=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${secure}`;
  }, []);

  const onSwitchProject = useCallback(() => {
    router.push("/home");
  }, [router]);

  const onSignOut = useCallback(async () => {
    if (role === "guest") {
      // Ends the guest session by clearing fs_guest server-side.
      await fetch("/api/guest/end", { method: "POST" }).catch(() => {});
    } else {
      // Standard Supabase sign-out via the existing endpoint.
      await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => {});
    }
    router.replace("/sign-in");
  }, [role, router]);

  // Belt-and-suspenders: log a console warning if the shell is mounted
  // on a desktop viewport (we should never get here in production thanks
  // to the middleware in §S1, but it caught a real bug during S2 dev).
  useEffect(() => {
    if (window.innerWidth >= 1024) {
      // eslint-disable-next-line no-console
      console.warn("[mobile-shell] rendered on a wide viewport — check middleware coverage");
    }
  }, []);

  return (
    <div className="m-shell">
      <MobileTopbar
        projectName={projectName}
        role={role}
        userInitial={user.initial}
        liveOnline={liveOnline}
        guestExpiresAt={guestExpiresAt}
        onOpenDrawer={() => setDrawerOpen(true)}
        onOpenAvatar={() => setDrawerOpen(true)}
      />

      <main className="m-shell__main">{children}</main>

      <MobileTabbar
        projectId={projectId}
        role={role}
        activeSurface={activeSurface}
        badges={badges}
      />

      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        projectName={projectName}
        role={role}
        displayName={user.displayName}
        email={user.email}
        onToggleTheme={onToggleTheme}
        onSwitchProject={onSwitchProject}
        onSignOut={onSignOut}
        installHref={role !== "guest" ? `/p/${projectId}/m/more#install` : undefined}
        desktopHref={role !== "guest" ? `/p/${projectId}/map` : undefined}
      />
    </div>
  );
}
