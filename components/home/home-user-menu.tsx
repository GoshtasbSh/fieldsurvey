"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Bell, Sun, Moon, User as UserIcon, LogOut } from "lucide-react";
import { signOutAction } from "@/app/account/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initialsOf } from "@/components/user-menu";

type Props = {
  user: {
    email: string | null;
    displayName: string | null;
  };
};

export function HomeUserMenu({ user }: Props) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = (mounted ? resolvedTheme ?? theme : "dark") as string;
  const isDark = current !== "light";
  const initials = initialsOf(user.displayName, user.email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Open user menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--bento-rule)] bg-gradient-to-br from-[var(--bento-magenta)] to-[var(--bento-accent)] text-[12px] font-bold text-[var(--bento-bg)] outline-none transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-[var(--bento-accent)] focus-visible:ring-offset-2"
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64 border-[var(--bento-rule)] bg-[var(--bento-surface)] text-[var(--bento-ink-1)]"
      >
        <DropdownMenuLabel className="px-2.5 py-2">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[var(--bento-magenta)] to-[var(--bento-accent)] text-[12px] font-bold text-[var(--bento-bg)]">
              {initials}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[12.5px] font-semibold text-[var(--bento-ink-1)]">
                {user.displayName || user.email?.split("@")[0] || "User"}
              </span>
              <span className="truncate text-[11px] text-[var(--bento-ink-3)]">
                {user.email ?? ""}
              </span>
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[var(--bento-rule)]" />
        <Link href="/account">
          <DropdownMenuItem className="cursor-pointer focus:bg-[var(--bento-surface-2)]">
            <UserIcon className="h-4 w-4" strokeWidth={1.7} />
            <span>Profile</span>
          </DropdownMenuItem>
        </Link>
        <Link href="/account/notifications">
          <DropdownMenuItem className="cursor-pointer focus:bg-[var(--bento-surface-2)]">
            <Bell className="h-4 w-4" strokeWidth={1.7} />
            <span>Notifications</span>
          </DropdownMenuItem>
        </Link>
        <DropdownMenuItem
          className="cursor-pointer focus:bg-[var(--bento-surface-2)]"
          onSelect={(e) => {
            e.preventDefault();
            setTheme(isDark ? "light" : "dark");
          }}
        >
          {isDark ? (
            <Sun className="h-4 w-4" strokeWidth={1.7} />
          ) : (
            <Moon className="h-4 w-4" strokeWidth={1.7} />
          )}
          <span>Switch to {isDark ? "light" : "dark"} theme</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-[var(--bento-rule)]" />
        <form
          action={async () => {
            await signOutAction();
          }}
        >
          <button
            type="submit"
            className="relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-[var(--bento-danger)] outline-none transition-colors hover:bg-[var(--bento-danger-soft)]"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.7} />
            <span>Sign out</span>
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
