"use client";

import Link from "next/link";
import { Icon, type IconKey } from "@/components/mobile/icons/icons";
import { tabsForRole } from "@/lib/mobile/tabs";
import { mobileProjectUrl, type MobileSurface } from "@/lib/mobile/surface-map";
import type { ProjectRole } from "@/lib/mobile/role-gate";

type Props = {
  projectId: string;
  role: ProjectRole;
  activeSurface: MobileSurface;
  /** map of surface → unread/queue badge count; only entries > 0 show */
  badges?: Partial<Record<MobileSurface, number>>;
};

/**
 * Bottom tab bar. Reflects the role's allowed tabs (see lib/mobile/tabs).
 * Uses <Link> for hard-shell navigations — client routing within a tab is
 * handled by the surface page.
 */
export function MobileTabbar({
  projectId,
  role,
  activeSurface,
  badges,
}: Props) {
  const tabs = tabsForRole(role);
  return (
    <nav
      aria-label="Primary"
      style={{
        height: "calc(72px + var(--m-safe-bottom))",
        paddingBottom: "var(--m-safe-bottom)",
        background: "var(--m-bg)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        borderTop: "1px solid var(--m-line)",
        display: "flex",
        position: "relative",
        zIndex: 4,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeSurface;
        const badgeN = badges?.[tab.id] ?? 0;
        return (
          <Link
            key={tab.id}
            href={mobileProjectUrl(projectId, tab.id)}
            aria-current={isActive ? "page" : undefined}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: 4,
              padding: "8px 0 6px",
              color: isActive ? "var(--m-accent)" : "var(--m-ink-3)",
              textDecoration: "none",
              position: "relative",
              minHeight: "var(--m-touch-min)",
            }}
          >
            <Icon name={tab.iconKey as IconKey} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.02em" }}>
              {tab.label}
            </span>
            {isActive ? (
              <span
                style={{
                  position: "absolute",
                  bottom: 6,
                  left: "50%",
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "var(--m-accent)",
                  transform: "translateX(-50%)",
                }}
              />
            ) : null}
            {badgeN > 0 ? (
              <span
                aria-label={`${badgeN} unread`}
                style={{
                  position: "absolute",
                  top: 4,
                  right: "calc(50% - 18px)",
                  background: "var(--m-danger)",
                  color: "#fff",
                  fontSize: 9,
                  fontWeight: 800,
                  padding: "1px 5px",
                  borderRadius: 100,
                  border: "2px solid var(--m-bg)",
                  minWidth: 16,
                  textAlign: "center",
                }}
              >
                {badgeN > 99 ? "99+" : badgeN}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
