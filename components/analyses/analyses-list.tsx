// components/analyses/analyses-list.tsx
"use client";
import type { AnalysisListItem } from "@/lib/analyses/types";
import { AnalysesListItem } from "./analyses-list-item";

type Props = {
  items: AnalysisListItem[];
  projectId: string;
  globalActiveQuestion: string | null;
  onAddClick: () => void;
  onOpenSettings: (cardId: string) => void;
  onRemove: (cardId: string) => void;
};

export function AnalysesList({ items, projectId, globalActiveQuestion, onAddClick, onOpenSettings, onRemove }: Props) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Spatial analyses</h2>
        <button
          onClick={onAddClick}
          className="rounded-md bg-[var(--accent-1,#0EA5E9)] text-white text-[12px] font-semibold py-1.5 px-3"
          aria-label="Add spatial analysis"
        >
          + Add spatial analysis
        </button>
      </div>
      {items.length === 0 ? (
        <div className="flex-1 grid place-items-center rounded-xl border border-dashed border-[var(--shell-border)] p-6 text-center">
          <div>
            <p className="text-[13px] mb-2">No spatial analyses added yet.</p>
            <p className="text-[11.5px] text-[var(--shell-text-muted)] mb-3">
              Browse the Spatial Analysis Toolbox to add hot-spot maps, autocorrelation, distance-decay and more.
            </p>
            <button
              onClick={onAddClick}
              className="rounded-md bg-[var(--accent-1,#0EA5E9)] text-white text-[12px] font-semibold py-1.5 px-3"
            >
              Open the toolbox
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-auto">
          {items.map((item) => (
            <AnalysesListItem
              key={`${item.cardId}-${item.addedAt}`}
              item={item}
              projectId={projectId}
              globalActiveQuestion={globalActiveQuestion}
              onOpenSettings={onOpenSettings}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
