// components/analyses/add-analysis-modal.tsx
"use client";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { TOOLBOXES, v1Toolboxes, getToolbox } from "@/lib/analyses/toolboxes";
import type { ToolboxSlug, SpatialCardCatalogEntry } from "@/lib/analyses/types";
import { ANALYSES_REGISTRY } from "@/lib/analyses/registry";
import { ToolboxLeftRail } from "./toolbox-left-rail";
import { AnalysisCardPreview } from "./analysis-card-preview";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (cardId: string) => void;
};

export function AddAnalysisModal({ open, onOpenChange, onAdd }: Props) {
  const v1 = v1Toolboxes();
  const [activeToolbox, setActiveToolbox] = useState<ToolboxSlug>(v1[0]?.slug ?? "symbology");
  const active = getToolbox(activeToolbox);

  const cardsInToolbox = ANALYSES_REGISTRY
    .filter((c): c is SpatialCardCatalogEntry => "toolbox" in c)
    .filter((c) => c.toolbox === activeToolbox)
    .sort((a, b) => a.cardOrder - b.cardOrder);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                     w-[min(1100px,92vw)] h-[min(720px,86vh)] rounded-2xl
                     bg-[var(--shell-1)] border border-[var(--shell-border)] shadow-2xl
                     grid grid-cols-[260px_1fr] overflow-hidden"
          aria-describedby="add-analysis-desc"
        >
          <ToolboxLeftRail
            toolboxes={TOOLBOXES}
            activeSlug={activeToolbox}
            onSelect={setActiveToolbox}
          />
          <div className="flex flex-col min-h-0">
            <header className="border-b border-[var(--shell-border)] p-4">
              {/*
               * Dialog.Title is required by Radix for accessibility (aria-labelledby).
               * We render the label as visually-hidden (display:none) so it satisfies
               * ARIA but doesn't produce a duplicate DOM text node for Testing Library.
               * The icon + description are the visible affordance; the left rail already
               * shows the active toolbox name.
               */}
              {/*
               * Dialog.Title is aria-labelled via `aria-label` — the toolbox name is
               * already visible in the highlighted left-rail tab, so we show only the
               * icon here to avoid a duplicate DOM text node that would break getByText.
               */}
              <Dialog.Title aria-label={active?.label} className="flex items-center gap-2 text-base font-semibold">
                <span aria-hidden="true" className="text-lg">{active?.icon}</span>
              </Dialog.Title>
              <p id="add-analysis-desc" className="text-[12px] text-[var(--shell-text-muted)] mt-1">
                {active?.description}
              </p>
            </header>
            <div className="flex-1 overflow-auto p-4">
              {cardsInToolbox.length === 0 ? (
                <div className="grid place-items-center h-full text-[var(--shell-text-muted)] text-sm">
                  No analyses in this toolbox yet — coming in v2.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {cardsInToolbox.map((card) => (
                    <AnalysisCardPreview key={card.id} card={card} onAdd={() => onAdd(card.id)} />
                  ))}
                </div>
              )}
            </div>
          </div>
          <Dialog.Close
            aria-label="Close"
            className="absolute top-3 right-3 rounded-md p-1.5
                       text-[var(--shell-text-muted)] hover:text-[var(--shell-text)]"
          >
            ✕
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
