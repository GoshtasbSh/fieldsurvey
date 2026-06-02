"use client";

import type { CSSProperties } from "react";
import { PlusGlyph } from "@/components/mobile/icons/icons";

type Props = {
  onClick?: () => void;
  href?: string;
  /** Offline queue count — KeyStone-style orange badge in the top-right. */
  badge?: number;
  /** Vertical offset from the bottom (in px), above the tab bar. */
  bottomOffset?: number;
  /** Disabled state — guest/member may not always have add access. */
  disabled?: boolean;
  ariaLabel?: string;
};

/**
 * Floating action button — KeyStone "＋" rendered as a solid two-bar glyph.
 * Default action is "Add point", but href/onClick are wired by the caller.
 *
 * The badge counts offline-queued points waiting to sync (KeyStone parity).
 * Renders only when badge > 0.
 */
export function MobileFab({
  onClick,
  href,
  badge,
  bottomOffset = 96,
  disabled,
  ariaLabel = "Add point",
}: Props) {
  const inner = (
    <>
      <PlusGlyph size={22} color="var(--m-accent-on)" />
      {typeof badge === "number" && badge > 0 ? (
        <span
          aria-label={`${badge} queued`}
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            background: "var(--m-warn)",
            color: "#fff",
            fontSize: 10,
            fontWeight: 800,
            padding: "2px 6px",
            borderRadius: 100,
            border: "2px solid var(--m-bg)",
            minWidth: 18,
            textAlign: "center",
          }}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </>
  );

  const style: CSSProperties = {
    position: "absolute",
    right: 18,
    bottom: bottomOffset,
    width: "var(--m-fab-size)",
    height: "var(--m-fab-size)",
    borderRadius: "50%",
    background: disabled ? "var(--m-line-2)" : "var(--m-accent)",
    color: disabled ? "var(--m-ink-3)" : "var(--m-accent-on)",
    display: "grid",
    placeItems: "center",
    fontSize: 28,
    fontWeight: 300,
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: disabled
      ? "0 4px 14px rgba(0,0,0,.2)"
      : "0 12px 32px rgba(56, 189, 248, 0.4), 0 0 0 8px rgba(56, 189, 248, 0.08)",
    zIndex: 3,
    WebkitTapHighlightColor: "transparent",
    textDecoration: "none",
  };

  if (href && !disabled) {
    return (
      <a href={href} aria-label={ariaLabel} style={style}>
        {inner}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      disabled={disabled}
      style={style}
    >
      {inner}
    </button>
  );
}
