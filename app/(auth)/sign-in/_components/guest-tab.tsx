"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ArrowRight } from "lucide-react";

/**
 * Guest sign-in panel. Single input — the admin-issued day-code — POSTed
 * to /api/guest/start. On 200 we have a signed `fs_guest` cookie and the
 * surveyor is dropped straight onto the project's mobile field shell.
 */
export function GuestTab() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/guest/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: code.trim() }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          projectId?: string;
          error?: string;
        };
        if (!res.ok || !body.ok || !body.projectId) {
          setError(body.error ?? "Invalid or expired code");
          return;
        }
        router.replace(`/p/${body.projectId}/field`);
      } catch {
        setError("Network error — try again");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="guest-code" className="block text-[12px] font-medium text-[var(--bento-ink-2)]">
          Project code
        </label>
        <input
          id="guest-code"
          name="code"
          type="text"
          required
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="e.g. K7F3M2"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="fos-input text-center font-mono text-[18px] tracking-[0.3em]"
          maxLength={12}
        />
        <p className="text-[11.5px] text-[var(--bento-ink-3)]">
          Codes are issued by your project admin and expire in 24 hours.
        </p>
      </div>

      {error && (
        <p className="text-[13px] text-[var(--bento-danger)]" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="fos-btn-primary" disabled={pending || code.trim().length === 0}>
        {pending ? (
          "Validating…"
        ) : (
          <>
            <ArrowRight size={14} /> Continue as guest
          </>
        )}
      </button>

      <div className="flex items-start gap-2 rounded-md border border-[var(--bento-rule)] bg-[var(--bento-surface-2)] p-3 text-[11.5px] text-[var(--bento-ink-3)]">
        <KeyRound size={13} className="mt-0.5 shrink-0" />
        <span>
          Guest mode lets you collect points without an account. Your work is attributed to the project,
          not to a personal profile. No data is shown until an admin reviews it.
        </span>
      </div>
    </form>
  );
}
