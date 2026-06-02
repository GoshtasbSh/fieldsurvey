"use client";

import { useEffect, useMemo } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { MobileShell } from "./mobile-shell";
import type { ProjectRole } from "@/lib/mobile/role-gate";
import { MOBILE_SURFACES, type MobileSurface } from "@/lib/mobile/surface-map";

type Props = {
  theme: "dark" | "light";
  projectId: string;
  projectName: string;
  role: ProjectRole;
  user: {
    displayName: string | null;
    email: string | null;
    initial: string;
  };
  guestExpiresAt?: string;
  children: React.ReactNode;
};

/**
 * Client wrapper for the mobile shell. Handles work that has to run in the
 * browser:
 *
 *  - Mounts data-theme on <html> for CSS variable scope.
 *  - Reads the active child segment (impossible from a server layout in
 *    Next.js 15) and passes it to the tab bar so it can highlight the
 *    correct tab without each page tracking its own active state.
 *  - Registers the service worker (only when this shell mounts — desktop
 *    users never see it, avoiding the "PWA on desktop" misclassification
 *    bug we already squashed in S1).
 */
export function MobileShellWrapper({
  theme,
  projectId,
  projectName,
  role,
  user,
  guestExpiresAt,
  children,
}: Props) {
  const segment = useSelectedLayoutSegment(); // returns the child segment, e.g. 'map' or 'survey'
  const activeSurface = useMemo<MobileSurface>(() => {
    if (segment && (MOBILE_SURFACES as readonly string[]).includes(segment)) {
      return segment as MobileSurface;
    }
    return "map";
  }, [segment]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // SW lives at /sw.js (built in S9). If absent (intermediate state), the
    // catch swallows the error so we don't spam the console.
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);

  return (
    <MobileShell
      projectId={projectId}
      projectName={projectName}
      role={role}
      activeSurface={activeSurface}
      user={user}
      guestExpiresAt={guestExpiresAt}
    >
      {children}
    </MobileShell>
  );
}
