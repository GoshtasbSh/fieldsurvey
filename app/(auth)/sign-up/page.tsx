"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { AuthWordmark } from "@/components/auth/auth-wordmark";
import { AuthGlassCard, AuthCardFooter } from "@/components/auth/auth-glass-card";
import { signUpAction } from "./actions";

export default function SignUpPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <AuthWordmark tagline="Create your FieldSurvey account in under a minute." />

      <AuthGlassCard title="Create your account" ribbon="New here">
        <form
          action={(fd) =>
            startTransition(async () => {
              const res = await signUpAction(fd);
              if (res?.error) setError(res.error);
            })
          }
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="displayName" className="block text-[12px] font-medium text-[var(--bento-ink-2)]">
              Name
            </label>
            <input
              id="displayName"
              name="displayName"
              placeholder="Ada Lovelace"
              className="fos-input"
            />
          </div>
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
          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-[12px] font-medium text-[var(--bento-ink-2)]">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              className="fos-input"
            />
          </div>

          {error && (
            <p className="text-[13px] text-[var(--bento-danger)]" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="fos-btn-primary" disabled={pending}>
            <UserPlus size={14} /> {pending ? "Creating…" : "Create account"}
          </button>
        </form>
      </AuthGlassCard>

      <AuthCardFooter>
        Already have one?{" "}
        <Link
          href="/sign-in"
          className="font-semibold text-[var(--bento-ink-1)] underline decoration-[var(--bento-rule)] underline-offset-4 hover:text-[var(--bento-accent)] hover:decoration-[var(--bento-accent)]"
        >
          Sign in
        </Link>
      </AuthCardFooter>
    </>
  );
}
