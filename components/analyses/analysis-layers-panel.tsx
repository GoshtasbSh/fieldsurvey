// components/analyses/analysis-layers-panel.tsx
"use client";
import { useState } from "react";
import type { PinnedAnalysisLayer } from "@/lib/analyses/types";
import { getCardById } from "@/lib/analyses/registry";
import type { SpatialCardCatalogEntry } from "@/lib/analyses/types";

const TOOLBOX_COLORS: Record<string, string> = {
  symbology: "#0EA5E9",
  analyzing_patterns: "#8B5CF6",
  mapping_clusters: "#EF4444",
  spatial_relationships: "#F59E0B",
  coverage_equity: "#10B981",
};

function layerColor(cardId: string): string {
  const card = getCardById(cardId) as SpatialCardCatalogEntry | undefined;
  const toolbox = card?.toolbox ?? "mapping_clusters";
  return TOOLBOX_COLORS[toolbox] ?? "#71717A";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} hr ago`;
}

type Props = {
  layers: PinnedAnalysisLayer[];
  loading: boolean;
  onToggleVisibility: (cardId: string, pinnedAt: string, visible: boolean) => void;
  onUnpin: (cardId: string, pinnedAt: string) => void;
  onOpenSettings: (cardId: string, pinnedAt: string) => void;
  onRename: (cardId: string, pinnedAt: string, name: string) => void;
};

export function AnalysisLayersPanel({ layers, loading, onToggleVisibility, onUnpin, onOpenSettings, onRename }: Props) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  if (loading) {
    return (
      <div className="space-y-2 px-1 py-2 animate-pulse">
        {[0, 1].map((i) => (
          <div key={i} className="h-9 rounded-lg bg-[var(--bento-surface-2,#F4F4F5)]" />
        ))}
      </div>
    );
  }

  if (layers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 px-3 text-center">
        <p className="text-[12px] font-semibold text-[var(--bento-ink-1)]">No analysis layers pinned.</p>
        <p className="text-[11px] text-[var(--bento-ink-3)] leading-snug">
          Run an analysis in the Analyze tab (→), then click{" "}
          <span className="font-bold">📌 Pin to left panel</span> to see it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1 py-1">
      {layers.map((layer) => {
        const key = `${layer.cardId}::${layer.pinnedAt}`;
        const color = layerColor(layer.cardId);
        const isEditing = editingKey === key;
        const card = getCardById(layer.cardId) as SpatialCardCatalogEntry | undefined;

        return (
          <div
            key={key}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--bento-surface-2,#F4F4F5)] group"
          >
            {/* Visibility toggle */}
            <button
              aria-label={`Toggle visibility for ${layer.layerName}`}
              onClick={() => onToggleVisibility(layer.cardId, layer.pinnedAt, !layer.visible)}
              className="shrink-0 text-[var(--bento-ink-3)] hover:text-[var(--bento-ink-1)] transition-colors"
            >
              {layer.visible ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              )}
            </button>

            {/* Color swatch */}
            <span
              className="shrink-0 h-2 w-2 rounded-full"
              style={{ backgroundColor: layer.visible ? color : "#9CA3AF" }}
            />

            {/* Layer name */}
            <div className="flex-1 min-w-0">
              {isEditing ? (
                <input
                  autoFocus
                  className="text-[12px] font-medium w-full bg-[var(--shell-1)] border border-[var(--shell-border)] rounded px-1 py-0.5"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => {
                    if (editValue.trim()) onRename(layer.cardId, layer.pinnedAt, editValue.trim());
                    setEditingKey(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (editValue.trim()) onRename(layer.cardId, layer.pinnedAt, editValue.trim());
                      setEditingKey(null);
                    }
                    if (e.key === "Escape") setEditingKey(null);
                  }}
                />
              ) : (
                <button
                  className="text-left w-full"
                  onDoubleClick={() => { setEditingKey(key); setEditValue(layer.layerName); }}
                  title="Double-click to rename"
                >
                  <span className={`text-[12px] font-medium block truncate ${layer.visible ? "text-[var(--bento-ink-1)]" : "opacity-50 text-[var(--bento-ink-3)]"}`}>
                    {layer.layerName}
                  </span>
                  <span className="text-[9.5px] font-mono text-[var(--bento-ink-3)] block truncate">
                    {card?.name ?? layer.cardId}
                    {layer.cachedAt ? ` · ${relativeTime(layer.cachedAt)}` : ""}
                  </span>
                </button>
              )}
            </div>

            {/* Action buttons — visible on group hover */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                aria-label={`Settings for ${layer.layerName}`}
                onClick={() => onOpenSettings(layer.cardId, layer.pinnedAt)}
                className="rounded p-0.5 text-[var(--bento-ink-3)] hover:text-[var(--bento-ink-1)] hover:bg-[var(--bento-surface-3,#E4E4E7)]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button
                aria-label={`Unpin ${layer.layerName}`}
                onClick={() => {
                  if (confirm(`Unpin "${layer.layerName}" from the Analysis tab?`)) {
                    onUnpin(layer.cardId, layer.pinnedAt);
                  }
                }}
                className="rounded p-0.5 text-[var(--bento-ink-3)] hover:text-red-400 hover:bg-[var(--bento-surface-3,#E4E4E7)]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
