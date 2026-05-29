import Link from "next/link";
import { Mail } from "lucide-react";
import { AuthWordmark } from "@/components/auth/auth-wordmark";
import { AuthGlassCard, AuthCardFooter } from "@/components/auth/auth-glass-card";

export default function CheckEmailPage() {
  return (
    <>
      <AuthWordmark tagline="One last step — your inbox holds the key." />

      <AuthGlassCard title="Check your email" ribbon="Verify">
        <div className="flex flex-col items-center gap-4 py-3 text-center">
          <div
            className="grid h-14 w-14 place-items-center rounded-[14px]"
            style={{
              background: "var(--bento-accent-soft)",
              color: "var(--bento-accent)",
            }}
          >
            <Mail size={26} />
          </div>
          <p className="text-[14px] leading-relaxed text-[var(--bento-ink-2)]">
            We sent a confirmation link to your inbox. Click it to finish signing up and we&apos;ll
            drop you straight into your project list.
          </p>
        </div>
      </AuthGlassCard>

      <AuthCardFooter>
        Wrong address?{" "}
        <Link
          href="/sign-up"
          className="font-semibold text-[var(--bento-ink-1)] underline decoration-[var(--bento-rule)] underline-offset-4 hover:text-[var(--bento-accent)] hover:decoration-[var(--bento-accent)]"
        >
          Try again
        </Link>
      </AuthCardFooter>
    </>
  );
}
