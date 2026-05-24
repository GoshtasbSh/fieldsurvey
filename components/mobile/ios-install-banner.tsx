"use client";

import { useEffect, useState } from "react";
import { Upload, Plus, X } from "lucide-react";

const DISMISS_COOKIE = "fs_ios_install_dismissed";

/**
 * iOS Safari install banner. iOS doesn't fire beforeinstallprompt, so we
 * detect the platform + standalone state and show a custom banner with
 * the two-step "tap Share → Add to Home Screen" instructions.
 *
 * Conditions to show:
 *   - iOS Safari (not Chrome iOS, not Firefox iOS — those don't expose A2HS)
 *   - Not already running in standalone mode
 *   - Cookie fs_ios_install_dismissed not set within the last 14 days
 */
export function IosInstallBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = navigator.userAgent;
    const isIPhoneOrIPad = /iPhone|iPad|iPod/.test(ua);
    // iOS Safari has Version/ + Safari/ but not CriOS/FxiOS
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    const standalone =
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia?.("(display-mode: standalone)").matches;
    if (!isIPhoneOrIPad || !isSafari || standalone) return;
    if (document.cookie.includes(`${DISMISS_COOKIE}=1`)) return;
    const t = setTimeout(() => setShow(true), 2500);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    setShow(false);
    document.cookie = `${DISMISS_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 14}; samesite=lax`;
  }

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-label="Install FieldSurvey"
      className="fixed bottom-[72px] left-3 right-3 z-50 rounded-2xl border border-[oklch(78%_0.155_234/0.32)] bg-[var(--shell-base-alpha-86)] p-3.5 shadow-[0_14px_36px_-10px_oklch(0%_0_0/0.55),inset_0_1px_0_oklch(100%_0_0/0.08)] backdrop-blur-[24px] backdrop-saturate-[180%]"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h4 className="flex items-center gap-1.5 font-display text-[13px] font-extrabold">
            <span className="h-1.5 w-1.5 rounded-full bg-[oklch(78%_0.155_234)] shadow-[0_0_8px_oklch(78%_0.155_234/0.35)]" />
            Install FieldSurvey
          </h4>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--shell-text-2)]">Add to your home screen for full-screen, offline-ready field work.</p>
        </div>
        <button onClick={dismiss} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--shell-text-muted)] hover:bg-[var(--shell-2)]" aria-label="Dismiss">
          <X className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
      </div>

      <div className="mt-2.5 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[11px] text-[var(--shell-text-2)]">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[oklch(78%_0.155_234/0.18)] text-[oklch(78%_0.155_234)]">
            <Upload className="h-3.5 w-3.5" strokeWidth={1.7} />
          </span>
          <span><b className="text-[var(--shell-text)]">1.</b> Tap the <strong>Share</strong> button below</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[var(--shell-text-2)]">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[oklch(78%_0.155_234/0.18)] text-[oklch(78%_0.155_234)]">
            <Plus className="h-3.5 w-3.5" strokeWidth={1.7} />
          </span>
          <span><b className="text-[var(--shell-text)]">2.</b> Choose <strong>&ldquo;Add to Home Screen&rdquo;</strong></span>
        </div>
      </div>

      <div className="mt-3 flex gap-1.5">
        <button onClick={dismiss} className="flex-1 rounded-lg bg-[var(--shell-3)] py-2 font-display text-[11px] font-extrabold text-[var(--shell-text-2)]">Not now</button>
        <button onClick={dismiss} className="flex-1 rounded-lg bg-[oklch(78%_0.155_234)] py-2 font-display text-[11px] font-extrabold text-[var(--shell-base)]">Got it</button>
      </div>
    </div>
  );
}
