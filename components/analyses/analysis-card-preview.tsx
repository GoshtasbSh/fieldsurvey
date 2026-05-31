// components/analyses/analysis-card-preview.tsx
"use client";
import Image from "next/image";
import type { SpatialCardCatalogEntry } from "@/lib/analyses/types";

type Props = {
  card: SpatialCardCatalogEntry;
  onAdd: () => void;
};

export function AnalysisCardPreview({ card, onAdd }: Props) {
  const img = card.previewImage;
  return (
    <article className="rounded-xl border border-[var(--shell-border)] bg-[var(--shell-1)] overflow-hidden flex flex-col">
      <div className="relative h-[140px] w-full bg-[var(--shell-2)]">
        <Image
          src={img.src}
          alt={img.alt}
          fill
          sizes="(min-width: 1280px) 320px, (min-width: 768px) 50vw, 100vw"
          style={{ objectFit: "cover" }}
          unoptimized={img.src.endsWith(".svg")}
        />
      </div>
      <div className="p-3 flex flex-col gap-2 flex-1 min-h-0">
        <header>
          <h3 className="font-semibold text-[13.5px] leading-tight">{card.name}</h3>
          <p className="text-[11.5px] text-[var(--shell-text-muted)] mt-0.5">{card.short}</p>
        </header>
        <section>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)] mb-1">
            What it answers
          </div>
          <ul className="list-disc pl-4 text-[11.5px] space-y-0.5">
            {card.questionsAnswered.slice(0, 2).map((q) => <li key={q}>{q}</li>)}
          </ul>
        </section>
        <section>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)] mb-1">
            What it does
          </div>
          <p className="text-[11.5px] leading-snug">{card.whatItDoes}</p>
        </section>
        <section>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)] mb-1">
            Inputs
          </div>
          <div className="flex flex-wrap gap-1">
            {card.inputRequirements.map((r) => (
              <span
                key={r}
                className="font-mono text-[9.5px] rounded-full border border-[var(--shell-border)] bg-[var(--shell-2)] px-1.5 py-0.5"
              >
                {r}
              </span>
            ))}
          </div>
        </section>
        <button
          onClick={onAdd}
          aria-label={`Add ${card.name} to Analyze tab`}
          className="mt-auto rounded-md bg-[var(--accent-1,#0EA5E9)] text-white text-[12px] font-semibold py-1.5 px-3 hover:opacity-90"
        >
          + Add to Analyze tab
        </button>
        <footer className="text-[9.5px] text-[var(--shell-text-muted)] mt-0.5">
          Image &copy;{" "}
          <a href={img.sourceUrl || "#"} target="_blank" rel="noopener" className="underline">
            {img.sourceTitle}
          </a>
          {" · "}
          {img.license}
        </footer>
      </div>
    </article>
  );
}
