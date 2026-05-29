"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Bell, Sun, Moon, ChevronDown } from "lucide-react";
import { UserMenu, type UserMenuUser } from "@/components/user-menu";
import { HistoryDropdown } from "@/components/desktop/history-dropdown";

type Props = {
  projectName: string;
  projectId: string;
  scope: "today" | "week" | "all";
  liveCount: number;
  user: UserMenuUser;
  /** ISO timestamp of the freshest dashboard_cache row, or null if no cache exists. */
  cachedAt?: string | null;
};

function formatCachedAge(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function DesktopTopbar({ projectName, projectId, scope, liveCount, user, cachedAt }: Props) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = (mounted ? resolvedTheme ?? theme : "dark") as string;
  const isDark = current !== "light";

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const userName = user?.displayName?.split(" ")[0] ?? "there";

  return (
    <header
      className="grid h-[64px] grid-cols-[280px_1fr_360px] items-center border-b border-[var(--bento-rule)] bg-[var(--bento-surface)] px-4"
      style={{ boxShadow: "var(--bento-shadow-xs)" }}
    >
      {/* ── Left: brand + project selector ─────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link
          href="/home"
          className="bento-focus relative h-10 w-10 rounded-[12px]"
          style={{
            background: "linear-gradient(135deg, var(--bento-accent), var(--bento-magenta))",
          }}
          aria-label="FieldSurvey home"
        >
          <span
            className="absolute inset-[10px] rounded-[5px]"
            style={{ background: "var(--bento-surface)" }}
          />
          <span
            className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ background: "var(--bento-accent)" }}
          />
        </Link>
        <div className="leading-tight">
          <div className="font-display text-[14.5px] font-bold tracking-tight">
            field<span style={{ color: "var(--bento-accent)" }}>survey</span>
          </div>
          <div className="text-[10.5px] text-[var(--bento-ink-3)]">spatial atlas</div>
        </div>
      </div>

      {/* ── Center: project pill + filter chips ────────────────────── */}
      <div className="flex items-center justify-center gap-2">
        <Link
          href="/home"
          className="bento-panel inline-flex items-center gap-2 py-[7px] pl-[7px] pr-3 transition hover:shadow-[var(--bento-shadow-md)]"
          style={{ borderRadius: "var(--bento-radius-md)" }}
        >
          <span
            className="h-6 w-6 flex-shrink-0 rounded-[7px]"
            style={{
              background: "linear-gradient(135deg, var(--bento-magenta), var(--bento-accent))",
            }}
          />
          <span className="flex flex-col items-start leading-tight">
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[var(--bento-ink-3)]">
              Project
            </span>
            <span className="text-[12.5px] font-semibold text-[var(--bento-ink-1)]">
              {projectName}
            </span>
          </span>
          <ChevronDown className="ml-1 h-3 w-3 text-[var(--bento-ink-3)]" strokeWidth={2} />
        </Link>

        <span className="bento-chip">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--bento-accent)" }}
          />
          {scope === "today" ? "Today" : scope === "week" ? "7 days" : "All time"}
        </span>
        <span className="bento-chip">M1 + F1 + R1</span>
        <button
          className="bento-chip"
          style={{ color: "var(--bento-ink-3)" }}
          title="Add filter"
        >
          + filter
        </button>
      </div>

      {/* ── Right: live status + History + theme + bell + avatar ───── */}
      <div className="flex items-center justify-end gap-2">
        {cachedAt && (
          <span
            className="hidden lg:inline-flex items-center gap-1.5 rounded-full border border-[var(--bento-rule)] bg-[var(--bento-surface-2)] px-2.5 py-1 font-mono text-[10.5px]"
            style={{ color: "var(--bento-ink-3)" }}
            title={`Cache as of ${cachedAt}`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--bento-success)" }}
            />
            cached {formatCachedAge(cachedAt)}
          </span>
        )}
        {liveCount > 0 && (
          <span className="bento-chip" style={{ color: "var(--bento-success)" }}>
            <span
              className="relative h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--bento-success)" }}
            >
              <span
                className="absolute inset-0 animate-ping rounded-full"
                style={{ background: "var(--bento-success)", opacity: 0.55 }}
              />
            </span>
            Live · {liveCount}
          </span>
        )}

        <HistoryDropdown projectId={projectId} />

        <ThemeToggle isDark={isDark} setTheme={setTheme} />

        <button
          aria-label="Notifications"
          className="bento-focus inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--bento-rule)] bg-[var(--bento-surface)] text-[var(--bento-ink-2)] transition hover:bg-[var(--bento-surface-3)] hover:text-[var(--bento-ink-1)]"
        >
          <Bell className="h-4 w-4" strokeWidth={1.8} />
        </button>

        <div className="hidden xl:flex items-baseline leading-tight" title={`${greeting}, ${userName}`}>
          <span className="text-[11.5px] font-medium text-[var(--bento-ink-2)]">
            Hi, <span className="font-semibold text-[var(--bento-ink-1)]">{userName}</span>
          </span>
        </div>

        <UserMenu projectId={projectId} user={user} compact />
      </div>
    </header>
  );
}

// ── Segmented light / dark toggle ───────────────────────────────────────────
function ThemeToggle({
  isDark,
  setTheme,
}: {
  isDark: boolean;
  setTheme: (t: string) => void;
}) {
  return (
    <div className="bento-seg" style={{ padding: "3px" }}>
      <button
        type="button"
        className={!isDark ? "bento-seg-on" : ""}
        onClick={() => setTheme("light")}
        aria-label="Light theme"
        title="Light"
      >
        <Sun className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        className={isDark ? "bento-seg-on" : ""}
        onClick={() => setTheme("dark")}
        aria-label="Dark theme"
        title="Dark"
      >
        <Moon className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
