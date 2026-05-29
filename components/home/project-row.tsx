import Link from "next/link";
import type { HomeCard } from "@/lib/queries/home";

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d === 0) {
    const h = Math.max(0, Math.floor(ms / 3_600_000));
    return h === 0 ? "now" : `${h}h`;
  }
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

export function ProjectRow({ card }: { card: HomeCard }) {
  return (
    <Link
      href={`/p/${card.id}`}
      className="grid grid-cols-[20px_minmax(160px,1fr)_minmax(180px,2fr)_80px_80px_90px_140px] items-center gap-3 border-b border-[var(--bento-rule)] px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--bento-surface-2)]"
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={
          card.status === "active"
            ? {
                background: "var(--bento-accent)",
                boxShadow: "0 0 6px var(--bento-accent-glow)",
              }
            : {
                border: "1px solid var(--bento-ink-3)",
              }
        }
      />
      <span className="truncate font-display text-[13.5px] font-bold text-[var(--bento-ink-1)]">
        {card.name}
      </span>
      <span className="truncate text-[12px] text-[var(--bento-ink-2)]">
        {card.description ?? "—"}
      </span>
      <span className="text-right font-mono text-[13px] text-[var(--bento-ink-1)]">
        {card.completed_count}
      </span>
      <span className="text-right font-mono text-[13px] text-[var(--bento-ink-1)]">
        {card.point_count}
      </span>
      <span className="text-right font-mono text-[12px] text-[var(--bento-ink-2)]">
        {relTime(card.last_activity_at)}
      </span>
      <span className="truncate text-[12px] text-[var(--bento-ink-3)]">
        {card.last_actor_name ?? "—"}
      </span>
    </Link>
  );
}
