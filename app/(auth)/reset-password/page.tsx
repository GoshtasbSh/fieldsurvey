"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AuthWordmark } from "@/components/auth/auth-wordmark";
import { AuthGlassCard, AuthCardFooter } from "@/components/auth/auth-glass-card";
import { resetPasswordAction } from "./actions";

export default function ResetPasswordPage() {
  const [msg, setMsg] = useState<{ ok?: boolean; error?: string }>({});
  const [pending, startTransition] = useTransition();

  return (
    <>
      <AuthWordmark tagline="Send a reset link to your inbox — we'll take it from there." />

      <AuthGlassCard title="Reset password" ribbon="Recovery">
        <form
          action={(fd) => startTransition(async () => setMsg(await resetPasswordAction(fd)))}
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

          {msg.error && (
            <p className="text-[13px] text-[var(--bento-danger)]" role="alert">
              {msg.error}
            </p>
          )}
          {msg.ok && (
            <p className="text-[13px] text-[var(--bento-success)]" role="status">
              Check your inbox for a reset link.
            </p>
          )}

          <button type="submit" className="fos-btn-primary" disabled={pending}>
            <ArrowRight size={14} /> {pending ? "Sending…" : "Send reset link"}
          </button>
        </form>
      </AuthGlassCard>

      <AuthCardFooter>
        Remembered it?{" "}
        <Link
          href="/sign-in"
          className="font-semibold text-[var(--bento-ink-1)] underline decoration-[var(--bento-rule)] underline-offset-4 hover:text-[var(--bento-accent)] hover:decoration-[var(--bento-accent)]"
        >
          Back to sign in
        </Link>
      </AuthCardFooter>
    </>
  );
}
