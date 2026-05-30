"use client";
import { Suspense } from "react";
import { getCardById } from "@/lib/analyses/registry";
import { getVizComponent } from "@/lib/analyses/viz-registry";
import { CardSkeleton } from "./card-skeleton";

type Props = { cardId: string; projectId: string; userRole?: string | null };

export function RegistryCard({ cardId, projectId, userRole }: Props) {
  const card = getCardById(cardId);
  if (!card) return null;
  if (card.stub) {
    return (
      <div className="bento-panel p-4 opacity-90">
        <div className="bento-label mb-1.5 flex items-center justify-between">
          <span>{card.name}</span>
          <span className="font-mono text-[9px] text-[var(--shell-text-muted)]">{card.id}</span>
        </div>
        <div className="text-[11px] leading-snug text-[var(--shell-text-muted)]">{card.short}</div>
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--shell-border)] bg-[var(--shell-2)] px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
          ○ Coming — vote in the Catalog drawer
        </div>
      </div>
    );
  }
  const Viz = getVizComponent(card.vizComponent);
  if (!Viz) return <CardSkeleton label={card.name} />;
  return (
    <Suspense fallback={<CardSkeleton label={card.name} />}>
      <Viz projectId={projectId} userRole={userRole} />
    </Suspense>
  );
}
