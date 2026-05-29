import Link from "next/link";
import { Plus } from "lucide-react";
import { HomeUserMenu } from "./home-user-menu";

type Props = {
  user: {
    email: string | null;
    displayName: string | null;
  };
};

export function HomeTopbar({ user }: Props) {
  return (
    <header className="grid h-[64px] grid-cols-[280px_1fr_360px] items-center border-b border-[var(--bento-rule)] bg-[var(--bento-surface)] px-6">
      <div className="flex items-center gap-3">
        <Link
          href="/home"
          className="bento-focus relative h-10 w-10 rounded-[12px]"
          style={{
            background:
              "linear-gradient(135deg, var(--bento-accent), var(--bento-magenta))",
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
      <div />
      <div className="flex items-center justify-end gap-3">
        <Link
          href="/home/new"
          className="inline-flex items-center gap-2 rounded-[var(--bento-radius-md)] bg-[var(--bento-accent)] px-3.5 py-2 text-[13px] font-semibold text-[var(--bento-on-accent)] shadow-[var(--bento-shadow-accent)] transition-transform hover:-translate-y-0.5"
        >
          <Plus size={14} /> New project
        </Link>
        <HomeUserMenu user={user} />
      </div>
    </header>
  );
}
