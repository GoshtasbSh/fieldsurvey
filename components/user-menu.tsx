"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Bell, Sun, Moon, User as UserIcon, Settings, LogOut, Users, MapPin } from "lucide-react";
import { signOutAction } from "@/app/account/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type UserMenuUser = {
  email: string | null;
  displayName: string | null;
  role: string | null;
} | null;

type Props = {
  projectId: string;
  user: UserMenuUser;
  /** mobile renders the trigger slightly larger and includes a theme item inside the menu */
  compact?: boolean;
};

export function initialsOf(name: string | null, email: string | null): string {
  const src = (name && name.trim()) || (email && email.split("@")[0]) || "?";
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function UserMenu({ projectId, user, compact = false }: Props) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = (mounted ? resolvedTheme ?? theme : "dark") as string;
  const isDark = current !== "light";
  const initials = initialsOf(user?.displayName ?? null, user?.email ?? null);
  const canManage = user?.role === "owner" || user?.role === "admin";
  const sizeCls = compact ? "h-9 w-9 text-[12px]" : "h-8 w-8 text-[11.5px]";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Open user menu"
          className={`inline-flex items-center justify-center rounded-full border border-[var(--shell-border)] bg-gradient-to-br from-[oklch(72%_0.18_305)] to-[oklch(78%_0.155_234)] font-bold text-[var(--shell-base)] outline-none transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-[oklch(78%_0.155_234)] focus-visible:ring-offset-2 ${sizeCls}`}
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64 border-[var(--shell-border)] bg-[var(--shell-1)] text-[var(--shell-text)]"
      >
        <DropdownMenuLabel className="px-2.5 py-2">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[oklch(72%_0.18_305)] to-[oklch(78%_0.155_234)] text-[12px] font-bold text-[var(--shell-base)]">
              {initials}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[12.5px] font-semibold text-[var(--shell-text)]">
                {user?.displayName || user?.email?.split("@")[0] || "User"}
              </span>
              <span className="truncate text-[11px] text-[var(--shell-text-muted)]">{user?.email ?? ""}</span>
              {user?.role && (
                <span className="mt-0.5 inline-flex w-fit items-center rounded-full bg-[oklch(78%_0.155_234/0.16)] px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wider text-[oklch(78%_0.155_234)]">
                  {user.role}
                </span>
              )}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[var(--shell-border)]" />
        <Link href="/account">
          <DropdownMenuItem className="cursor-pointer focus:bg-[var(--shell-2)]">
            <UserIcon className="h-4 w-4" strokeWidth={1.7} />
            <span>Profile</span>
          </DropdownMenuItem>
        </Link>
        <Link href="/account/notifications">
          <DropdownMenuItem className="cursor-pointer focus:bg-[var(--shell-2)]">
            <Bell className="h-4 w-4" strokeWidth={1.7} />
            <span>Notifications</span>
          </DropdownMenuItem>
        </Link>
        <Link href={`/p/${projectId}/settings`}>
          <DropdownMenuItem className="cursor-pointer focus:bg-[var(--shell-2)]">
            <Settings className="h-4 w-4" strokeWidth={1.7} />
            <span>Project settings</span>
          </DropdownMenuItem>
        </Link>
        <DropdownMenuItem
          className="cursor-pointer focus:bg-[var(--shell-2)]"
          onSelect={(e) => {
            e.preventDefault();
            setTheme(isDark ? "light" : "dark");
          }}
        >
          {isDark ? <Sun className="h-4 w-4" strokeWidth={1.7} /> : <Moon className="h-4 w-4" strokeWidth={1.7} />}
          <span>Switch to {isDark ? "light" : "dark"} theme</span>
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuSeparator className="bg-[var(--shell-border)]" />
            <DropdownMenuLabel className="px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-wider text-[var(--shell-text-muted)]">
              Admin
            </DropdownMenuLabel>
            <Link href={`/p/${projectId}/members`}>
              <DropdownMenuItem className="cursor-pointer focus:bg-[var(--shell-2)]">
                <Users className="h-4 w-4" strokeWidth={1.7} />
                <span>Manage members</span>
              </DropdownMenuItem>
            </Link>
            <Link href={`/p/${projectId}/points`}>
              <DropdownMenuItem className="cursor-pointer focus:bg-[var(--shell-2)]">
                <MapPin className="h-4 w-4" strokeWidth={1.7} />
                <span>All points</span>
              </DropdownMenuItem>
            </Link>
          </>
        )}
        <DropdownMenuSeparator className="bg-[var(--shell-border)]" />
        <form
          action={async () => {
            await signOutAction();
          }}
        >
          <button
            type="submit"
            className="relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-[oklch(68%_0.21_25)] outline-none transition-colors hover:bg-[oklch(68%_0.21_25/0.12)]"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.7} />
            <span>Sign out</span>
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
