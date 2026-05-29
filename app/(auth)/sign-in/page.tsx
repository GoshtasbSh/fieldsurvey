"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Lock, Globe } from "lucide-react";
import { AuthWordmark } from "@/components/auth/auth-wordmark";
import { AuthGlassCard, AuthCardFooter } from "@/components/auth/auth-glass-card";
import { signInAction, magicLinkAction } from "./actions";
import { GuestTab } from "./_components/guest-tab";

type Mode = "member" | "guest";

export default function SignInPage() {
  const [mode, setMode] = useState<Mode>("member");
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <AuthWordmark tagline="Door-to-door surveys with cartographic precision." />

      <AuthGlassCard
        title={mode === "member" ? "Sign in" : "Guest access"}
        ribbon={mode === "member" ? "✦ Magic link" : "✦ Day-code"}
      >
        <ModeToggle
          mode={mode}
          onChange={(m) => {
            setMode(m);
            setError(null);
            setMagicSent(false);
          }}
        />

        {mode === "guest" ? (
          <GuestTab />
        ) : (
          <>
            <form
              action={(fd) =>
                startTransition(async () => {
                  if (showPassword) {
                    const r = await signInAction(fd);
                    if (r?.error) setError(r.error);
                  } else {
                    const r = await magicLinkAction(fd);
                    if (r?.error) setError(r.error);
                    if (r?.ok) {
                      setMagicSent(true);
                      setError(null);
                    }
                  }
                })
              }
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <label htmlFor="email" className="block text-[12px] font-medium text-[var(--bento-ink-2)]">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@university.edu"
                  className="fos-input font-mono"
                />
              </div>

              {showPassword && (
                <div className="space-y-1.5">
                  <label htmlFor="password" className="block text-[12px] font-medium text-[var(--bento-ink-2)]">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required={showPassword}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="fos-input"
                  />
                </div>
              )}

              {error && (
                <p className="text-[13px] text-[var(--bento-danger)]" role="alert">
                  {error}
                </p>
              )}
              {magicSent && (
                <p className="text-[13px] text-[var(--bento-success)]" role="status">
                  Check your inbox — we sent you a one-tap sign-in link.
                </p>
              )}

              <button type="submit" className="fos-btn-primary" disabled={pending}>
                {pending ? (
                  "Working…"
                ) : showPassword ? (
                  <>
                    <Lock size={14} /> Sign in with password
                  </>
                ) : (
                  <>
                    <ArrowRight size={14} /> Send magic link
                  </>
                )}
              </button>
            </form>

            <div className="fos-divider my-5">or</div>

            <button
              type="button"
              className="fos-btn-secondary"
              onClick={() => {}}
              aria-label="Continue with Google (coming soon)"
            >
              <GoogleGlyph />
              <span className="flex-1 text-left">Continue with Google</span>
              <span className="fos-badge-soon">soon</span>
            </button>

            <div className="mt-4 flex items-center justify-between text-[12.5px] text-[var(--bento-ink-2)]">
              <button
                type="button"
                onClick={() => {
                  setShowPassword((v) => !v);
                  setError(null);
                  setMagicSent(false);
                }}
                className="underline decoration-[var(--bento-rule)] underline-offset-4 transition-colors hover:text-[var(--bento-accent)] hover:decoration-[var(--bento-accent)]"
              >
                {showPassword ? "Use magic link instead" : "Use a password instead"}
              </button>
              <span className="inline-flex items-center gap-1.5">
                <Globe size={11} />
                <span className="text-[var(--bento-ink-3)]">University SSO</span>
                <span className="fos-badge-soon">soon</span>
              </span>
            </div>
          </>
        )}
      </AuthGlassCard>

      <AuthCardFooter>
        New here?{" "}
        <Link
          href="/sign-up"
          className="font-semibold text-[var(--bento-ink-1)] underline decoration-[var(--bento-rule)] underline-offset-4 hover:text-[var(--bento-accent)] hover:decoration-[var(--bento-accent)]"
        >
          Create an account
        </Link>
        <span className="mx-2 text-[var(--bento-ink-4)]">·</span>
        <Link
          href="/reset-password"
          className="underline decoration-[var(--bento-rule)] underline-offset-4 hover:text-[var(--bento-accent)] hover:decoration-[var(--bento-accent)]"
        >
          Forgot password?
        </Link>
      </AuthCardFooter>
    </>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const tabs: { key: Mode; label: string }[] = [
    { key: "member", label: "Member" },
    { key: "guest", label: "Guest" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Sign-in mode"
      className="mb-5 grid grid-cols-2 gap-1 rounded-full border border-[var(--bento-rule)] bg-[var(--bento-surface-2)] p-1"
    >
      {tabs.map((t) => {
        const active = mode === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={[
              "rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              active
                ? "bg-[var(--bento-surface-1)] text-[var(--bento-ink-1)] shadow-[var(--bento-shadow-1)]"
                : "text-[var(--bento-ink-3)] hover:text-[var(--bento-ink-2)]",
            ].join(" ")}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285f4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.55c2.08-1.92 3.29-4.74 3.29-8.09z"
      />
      <path
        fill="#34a853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.55-2.76c-.98.66-2.23 1.06-3.73 1.06-2.87 0-5.3-1.94-6.17-4.55H2.18v2.85A11 11 0 0 0 12 23z"
      />
      <path
        fill="#fbbc05"
        d="M5.83 14.09a6.6 6.6 0 0 1-.35-2.09c0-.73.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.44 1.18 4.93l3.65-2.84z"
      />
      <path
        fill="#ea4335"
        d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.65 2.84C6.7 7.32 9.13 5.38 12 5.38z"
      />
    </svg>
  );
}
