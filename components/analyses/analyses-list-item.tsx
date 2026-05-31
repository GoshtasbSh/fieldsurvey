// components/analyses/analyses-list-item.tsx
"use client";
import type { AnalysisListItem, SpatialCardCatalogEntry } from "@/lib/analyses/types";
import { getCardById } from "@/lib/analyses/registry";
import { Suspense } from "react";
import { getVizComponent } from "@/lib/analyses/viz-registry";

type Props = {
  item: AnalysisListItem;
  projectId: string;
  globalActiveQuestion: string | null;
  onOpenSettings: (cardId: string) => void;
  onRemove: (cardId: string) => void;
};

export function AnalysesListItem({ item, projectId, globalActiveQuestion, onOpenSettings, onRemove }: Props) {
  const card = getCardById(item.cardId) as SpatialCardCatalogEntry | undefined;
  if (!card) return null;

  const Viz = getVizComponent(card.vizComponent);
  const inheritedQ =
    (item.settings.questionKey as string | undefined) === "inherit_global" || !item.settings.questionKey
      ? globalActiveQuestion
      : (item.settings.questionKey as string);

  return (
    <article className="rounded-xl border border-[var(--shell-border)] bg-[var(--shell-1)] p-3 flex flex-col gap-2">
      {/* Clickable header — entire row opens settings */}
      <button
        className="flex items-start justify-between gap-2 text-left w-full group"
        onClick={() => onOpenSettings(card.id)}
        aria-label={`Open settings for ${card.name}`}
      >
        <div className="min-w-0">
          <h3 className="font-semibold text-[13px] group-hover:text-[var(--accent-1,#0EA5E9)] transition-colors">
            {card.name}
          </h3>
          <p className="text-[11px] text-[var(--shell-text-muted)] font-mono">
            {card.id} {inheritedQ ? `· Q: ${inheritedQ}` : "· no question yet"}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span aria-hidden className="rounded-md p-1 text-[var(--shell-text-muted)] group-hover:text-[var(--shell-text)]">
            ⚙
          </span>
          <button
            aria-label={`Remove ${card.name}`}
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Remove "${card.name}" from the Analyze tab?`)) onRemove(card.id);
            }}
            className="rounded-md p-1 text-[var(--shell-text-muted)] hover:bg-[var(--shell-2)] hover:text-red-400"
          >
            ✕
          </button>
        </div>
      </button>
      <div className="min-h-[80px]">
        {Viz ? (
          <Suspense fallback={<div className="text-[11px] text-[var(--shell-text-muted)]">Loading…</div>}>
            <Viz projectId={projectId} settings={item.settings} />
          </Suspense>
        ) : (
          <div className="text-[11px] text-[var(--shell-text-muted)]">No viz registered.</div>
        )}
      </div>
    </article>
  );
}
