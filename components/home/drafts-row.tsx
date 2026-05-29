import Link from "next/link";
import type { HomeCard } from "@/lib/queries/home";
import { ArrowRight } from "lucide-react";

export function DraftsRow({ cards }: { cards: HomeCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="bento-label">
          Finish setting up ·{" "}
          <span className="text-[var(--bento-ink-3)]">{cards.length}</span>
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.id}
            href={`/p/${c.id}`}
            className="rounded-[var(--bento-radius-lg)] border bg-[var(--bento-warning-soft)] p-4 transition-all hover:-translate-y-0.5"
            style={{ borderColor: "color-mix(in oklch, var(--bento-warning) 30%, transparent)" }}
          >
            <h3 className="mb-1 font-display text-[14.5px] font-bold text-[var(--bento-ink-1)]">
              {c.name}
            </h3>
            <p className="mb-3 line-clamp-1 text-[12px] text-[var(--bento-ink-2)]">
              {c.description ?? "—"}
            </p>
            <span
              className="inline-flex items-center gap-1.5 rounded-[var(--bento-radius-sm)] px-2.5 py-1 text-[11.5px] font-semibold"
              style={{
                background: "color-mix(in oklch, var(--bento-warning) 18%, transparent)",
                color: "var(--bento-warning)",
              }}
            >
              Resume setup <ArrowRight size={11} />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
