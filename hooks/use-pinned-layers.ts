// hooks/use-pinned-layers.ts
"use client";
import { useCallback, useEffect, useState } from "react";
import type { PinnedAnalysisLayer } from "@/lib/analyses/types";

export function usePinnedLayers(projectId: string | undefined) {
  const [layers, setLayers] = useState<PinnedAnalysisLayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/pinned-layers`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { layers: fetched } = (await res.json()) as { layers: PinnedAnalysisLayer[] };
      setLayers(fetched);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const pin = useCallback(async (layer: Omit<PinnedAnalysisLayer, "pinnedAt">) => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/pinned-layers`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(layer),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { layers: updated } = (await res.json()) as { layers: PinnedAnalysisLayer[] };
    setLayers(updated);
  }, [projectId]);

  const unpin = useCallback(async (cardId: string, pinnedAt: string) => {
    if (!projectId) return;
    const res = await fetch(
      `/api/projects/${projectId}/pinned-layers?cardId=${encodeURIComponent(cardId)}&pinnedAt=${encodeURIComponent(pinnedAt)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { layers: updated } = (await res.json()) as { layers: PinnedAnalysisLayer[] };
    setLayers(updated);
  }, [projectId]);

  const toggleVisibility = useCallback(async (cardId: string, pinnedAt: string, visible: boolean) => {
    if (!projectId) return;
    // Optimistic update
    setLayers((prev) =>
      prev.map((l) => l.cardId === cardId && l.pinnedAt === pinnedAt ? { ...l, visible } : l),
    );
    const res = await fetch(`/api/projects/${projectId}/pinned-layers`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId, pinnedAt, visible }),
    });
    if (!res.ok) {
      // Revert optimistic update on failure
      setLayers((prev) =>
        prev.map((l) => l.cardId === cardId && l.pinnedAt === pinnedAt ? { ...l, visible: !visible } : l),
      );
    }
  }, [projectId]);

  const updateCachedResult = useCallback(async (cardId: string, pinnedAt: string, cachedResult: unknown) => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/pinned-layers`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId, pinnedAt, cachedResult }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { layers: updated } = (await res.json()) as { layers: PinnedAnalysisLayer[] };
    setLayers(updated);
  }, [projectId]);

  const rename = useCallback(async (cardId: string, pinnedAt: string, layerName: string) => {
    if (!projectId) return;
    setLayers((prev) =>
      prev.map((l) => l.cardId === cardId && l.pinnedAt === pinnedAt ? { ...l, layerName } : l),
    );
    const res = await fetch(`/api/projects/${projectId}/pinned-layers`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId, pinnedAt, layerName }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }, [projectId]);

  return { layers, loading, error, refresh, pin, unpin, toggleVisibility, updateCachedResult, rename };
}
