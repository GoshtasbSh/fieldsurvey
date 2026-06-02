"use client";

import { useEffect, useRef } from "react";
import { Icon, type IconKey } from "@/components/mobile/icons/icons";
import type { ProjectRole } from "@/lib/mobile/role-gate";
import { ROLE_LABEL, ROLE_COLOR } from "@/lib/mobile/tabs";

type Item =
  | { type: "link"; label: string; href: string; icon: IconKey; danger?: boolean }
  | { type: "action"; label: string; onClick: () => void; icon: IconKey; danger?: boolean }
  | { type: "divider" };

type Props = {
  open: boolean;
  onClose: () => void;
  projectName: string;
  role: ProjectRole;
  displayName: string | null;
  email: string | null;
  onToggleTheme: () => void;
  onSwitchProject: () => void;
  onSignOut: () => void;
  installHref?: string;
  desktopHref?: string;
};

/**
 * Hamburger drawer — left-side slide-out, max 320px wide. Holds account info
 * and the role-specific menu items. Mirrors KeyStone's sidebar but only
 * shows entries that don't already live on the tab bar (Settings/Members
 * live in More for admin, not here).
 */
export function MobileDrawer({
  open,
  onClose,
  projectName,
  role,
  displayName,
  email,
  onToggleTheme,
  onSwitchProject,
  onSignOut,
  installHref,
  desktopHref,
}: Props) {
  // Trap focus by locking body scroll while the drawer is open.
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  // Close on Escape + Tab-based focus loop within the drawer.
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;

    // Move focus into the drawer when it opens so keyboard / screen-reader
    // users don't stay anchored behind the scrim on the hamburger button.
    closeBtnRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab") {
        // Cycle focus among the drawer's tabbable descendants only.
        const root = drawerRef.current;
        if (!root) return;
        const focusables = root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const items: Item[] = [];
  if (installHref) {
    items.push({ type: "link", label: "Install app", href: installHref, icon: "install" });
  }
  if (desktopHref) {
    items.push({ type: "link", label: "Open desktop dashboard", href: desktopHref, icon: "switch-project" });
  }
  items.push(
    { type: "action", label: "Toggle theme", onClick: onToggleTheme, icon: "settings" },
  );
  if (role !== "guest") {
    items.push({ type: "action", label: "Switch project", onClick: onSwitchProject, icon: "switch-project" });
  }
  items.push({ type: "divider" });
  items.push({
    type: "action",
    label: role === "guest" ? "End guest session" : "Sign out",
    onClick: onSignOut,
    icon: "sign-out",
    danger: true,
  });

  return (
    <>
      <div
        aria-hidden={!open}
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: open ? "rgba(0,0,0,0.5)" : "transparent",
          backdropFilter: open ? "blur(2px)" : "none",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 200ms ease, background 200ms ease",
          zIndex: 50,
        }}
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: "min(320px, 86vw)",
          background: "var(--m-bg)",
          borderRight: "1px solid var(--m-line)",
          transform: open ? "translateX(0)" : "translateX(-105%)",
          transition: "transform 240ms cubic-bezier(.22,.61,.36,1)",
          zIndex: 51,
          display: "flex",
          flexDirection: "column",
          paddingTop: "var(--m-safe-top)",
          paddingBottom: "var(--m-safe-bottom)",
          paddingLeft: "var(--m-safe-left)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 16px 12px",
            borderBottom: "1px solid var(--m-line)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--m-ink)" }}>
              {displayName ?? email ?? "Signed in"}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--m-ink-2)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {projectName}
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 9.5,
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: ROLE_COLOR[role],
              }}
            >
              {ROLE_LABEL[role]}
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            style={{
              width: 36,
              height: 36,
              display: "grid",
              placeItems: "center",
              background: "transparent",
              border: "none",
              color: "var(--m-ink)",
              cursor: "pointer",
            }}
          >
            <Icon name="x" />
          </button>
        </header>

        <nav style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {items.map((it, i) =>
            it.type === "divider" ? (
              <div
                key={`d${i}`}
                style={{ height: 1, background: "var(--m-line)", margin: "10px 12px" }}
              />
            ) : (
              <DrawerRow key={i} item={it} />
            ),
          )}
        </nav>
      </aside>
    </>
  );
}

function DrawerRow({ item }: { item: Exclude<Item, { type: "divider" }> }) {
  const body = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        minHeight: "var(--m-touch-min)",
        color: item.danger ? "var(--m-danger)" : "var(--m-ink)",
        cursor: "pointer",
        textDecoration: "none",
      }}
    >
      <Icon name={item.icon} />
      <span style={{ fontSize: 14, fontWeight: 600 }}>{item.label}</span>
    </div>
  );
  if (item.type === "link") {
    return <a href={item.href}>{body}</a>;
  }
  return (
    <button
      onClick={item.onClick}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        width: "100%",
        textAlign: "left",
      }}
    >
      {body}
    </button>
  );
}
