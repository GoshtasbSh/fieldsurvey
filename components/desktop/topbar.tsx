"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Bell, Sun, Moon } from "lucide-react";
import { UserMenu, type UserMenuUser } from "@/components/user-menu";

type Props = {
  projectName: string;
  projectId: string;
  scope: "today" | "week" | "all";
  liveCount: number;
  user: UserMenuUser;
};

export function DesktopTopbar({ projectName, projectId, scope, liveCount, user }: Props) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = (mounted ? resolvedTheme ?? theme : "dark") as string;
  const isDark = current !== "light";

  return (
    <header className="grid h-[52px] grid-cols-[280px_1fr_360px] items-center border-b border-[var(--shell-border)] bg-gradient-to-b from-[var(--shell-1)] to-[var(--shell-base)] relative">
      <div className="flex items-center gap-3 pl-[18px]">
        <Link href="/home" className="relative h-[26px] w-[26px] rounded-[7px] bg-[conic-gradient(from_200deg,oklch(78%_0.155_234)_0deg,transparent_220deg,oklch(78%_0.155_234)_360deg)] before:absolute before:inset-1 before:rounded-[4px] before:bg-[var(--shell-base)] after:absolute after:inset-0 after:m-auto after:h-[6px] after:w-[6px] after:rounded-full after:bg-[oklch(78%_0.155_234)] after:shadow-[0_0_12px_oklch(78%_0.155_234/0.35)]" />
        <span className="font-display text-[14.5px] font-extrabold tracking-tight">
          field<span className="text-[oklch(78%_0.155_234)]">survey</span>
        </span>
      </div>

      <div className="flex items-center justify-center gap-3.5">
        <Link
          href="/home"
          className="inline-flex items-center gap-2.5 rounded-[9px] border border-[var(--shell-border)] bg-[var(--shell-2)] py-[5px] pl-[6px] pr-3 text-[12.5px] hover:border-[var(--shell-border-soft)] hover:bg-[var(--shell-3)] transition"
        >
          <span className="h-[22px] w-[22px] flex-shrink-0 rounded-[5px] bg-gradient-to-br from-[oklch(72%_0.18_305)] to-[oklch(78%_0.155_234)]" />
          <span className="flex flex-col items-start leading-tight">
            <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">Project</span>
            <span className="font-semibold text-[var(--shell-text)] text-[12.5px]">{projectName}</span>
          </span>
          <span className="text-[var(--shell-text-muted)] text-[10px]">▾</span>
        </Link>
        <div className="inline-flex rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] p-0.5">
          {(["today", "week", "all"] as const).map((s) => (
            <button
              key={s}
              className={`rounded-md px-[11px] py-1 font-display text-[10.5px] font-bold transition ${
                scope === s
                  ? "bg-[var(--shell-elevated)] text-[var(--shell-text)] shadow-[inset_0_0_0_1px_var(--shell-border)]"
                  : "text-[var(--shell-text-muted)] hover:text-[var(--shell-text-2)]"
              }`}
            >
              {s === "all" ? "All time" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2.5 pr-[18px]">
        <span className="inline-flex items-center gap-[7px] rounded-full border border-[oklch(76%_0.16_158/0.3)] bg-[oklch(76%_0.16_158/0.1)] py-1 pl-2 pr-[11px] text-[11px] font-semibold text-[oklch(76%_0.16_158)]">
          <span className="relative h-[6px] w-[6px] rounded-full bg-[oklch(76%_0.16_158)] after:absolute after:inset-0 after:animate-ping after:rounded-full after:bg-[oklch(76%_0.16_158/0.55)]" />
          Live · {liveCount} surveyors
        </span>
        <button
          aria-label="Notifications"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--shell-text-2)] hover:bg-[var(--shell-2)] hover:text-[var(--shell-text)] transition"
        >
          <Bell className="h-4 w-4" strokeWidth={1.7} />
        </button>
        <button
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--shell-text-2)] hover:bg-[var(--shell-2)] hover:text-[var(--shell-text)] transition"
        >
          {isDark ? <Sun className="h-4 w-4" strokeWidth={1.7} /> : <Moon className="h-4 w-4" strokeWidth={1.7} />}
        </button>

        <UserMenu projectId={projectId} user={user} />
      </div>
    </header>
  );
}
