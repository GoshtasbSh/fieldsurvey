"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/mobile/icons/icons";
import { ROLE_LABEL, ROLE_COLOR } from "@/lib/mobile/tabs";
import type { ProjectRole } from "@/lib/mobile/role-gate";

type Props = {
  projectName: string;
  role: ProjectRole;
  userInitial: string;
  liveOnline?: number;
  guestExpiresAt?: string; // ISO
  onOpenDrawer: () => void;
  onOpenAvatar: () => void;
};

/**
 * Mobile top bar. Three columns: hamburger | project-name + role-pill | live + avatar.
 * Height fixed at 56px so it lines up with the safe-area top + status bar.
 */
export function MobileTopbar({
  projectName,
  role,
  userInitial,
  liveOnline,
  guestExpiresAt,
  onOpenDrawer,
  onOpenAvatar,
}: Props) {
  // Hydration-safe countdown. Server (and first-paint client) renders just
  // "Guest"; once mounted we recompute "Guest · 6h left" every minute. This
  // avoids the textbook mismatch where SSR's "expired" or "Nh left" differs
  // from the client's first-tick value.
  const [remaining, setRemaining] = useState<string | null>(null);
  useEffect(() => {
    if (role !== "guest" || !guestExpiresAt) return;
    const tick = () => setRemaining(formatGuestRemaining(guestExpiresAt));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [role, guestExpiresAt]);
  const roleLabel = remaining ? `${ROLE_LABEL.guest} · ${remaining}` : ROLE_LABEL[role];

  return (
    <header
      className="m-topbar"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        // Topbar absorbs the safe-area-inset-top so the iPhone notch /
        // Dynamic Island doesn't clip the hamburger. The main scroll
        // region (see shell.css .m-shell__main) no longer adds it again.
        height: "calc(56px + var(--m-safe-top))",
        paddingTop: "var(--m-safe-top)",
        padding: "var(--m-safe-top) 12px 0 12px",
        borderBottom: "1px solid var(--m-line)",
        background: "var(--m-bg)",
        position: "relative",
        zIndex: 4,
      }}
    >
      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label="Open menu"
        style={{
          width: 40,
          height: 40,
          display: "grid",
          placeItems: "center",
          background: "transparent",
          border: "none",
          color: "var(--m-ink)",
          cursor: "pointer",
        }}
      >
        <Icon name="menu" />
      </button>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 1,
          minWidth: 0,
          flex: 1,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "60vw",
          }}
        >
          {projectName}
        </div>
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 800,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: ROLE_COLOR[role],
          }}
        >
          {roleLabel}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {typeof liveOnline === "number" && liveOnline > 0 ? (
          <LiveBadge n={liveOnline} />
        ) : null}
        <button
          type="button"
          onClick={onOpenAvatar}
          aria-label="Open user menu"
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: avatarGradient(role),
            color: "var(--m-bg)",
            fontSize: 13,
            fontWeight: 800,
            display: "grid",
            placeItems: "center",
            border: "none",
            cursor: "pointer",
          }}
        >
          {userInitial}
        </button>
      </div>
    </header>
  );
}

function avatarGradient(role: ProjectRole): string {
  if (role === "guest") return "linear-gradient(135deg, #f59e0b, #d97706)";
  if (role === "member") return "linear-gradient(135deg, #10b981, #059669)";
  return "linear-gradient(135deg, #38bdf8, #0ea5e9)";
}

function LiveBadge({ n }: { n: number }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 100,
        background: "rgba(16, 185, 129, 0.14)",
        color: "var(--m-success)",
        fontSize: 10,
        fontWeight: 700,
        border: "1px solid rgba(16, 185, 129, 0.3)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "currentColor",
          animation: "m-blink 1.6s infinite",
        }}
      />
      {n}
      <style>{`
        @keyframes m-blink {
          0%   { box-shadow: 0 0 0 0 rgba(16,185,129,0.6); }
          100% { box-shadow: 0 0 0 6px rgba(16,185,129,0); }
        }
      `}</style>
    </div>
  );
}

function formatGuestRemaining(expiresAtIso: string): string {
  // Only called from inside useEffect (after mount) so Date.now() is safe.
  const ms = Date.parse(expiresAtIso) - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return `${h}h left`;
  const m = Math.ceil(ms / 60_000);
  return `${m}m left`;
}
