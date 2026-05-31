// hooks/use-added-analyses.ts
"use client";
import { useCallback, useEffect, useState } from "react";
import type { AnalysisListItem } from "@/lib/analyses/types";

type State = {
  items: AnalysisListItem[];
  activeQuestion: string | null;
  loading: boolean;
  error: string | null;
};

export function useAddedAnalyses(projectId: string | undefined) {
  const [state, setState] = useState<State>({ items: [], activeQuestion: null, loading: true, error: null });

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`/api/projects/${projectId}/added-analyses`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { items: AnalysisListItem[]; activeQuestion: string | null };
      setState({ items: json.items, activeQuestion: json.activeQuestion, loading: false, error: null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const add = useCallback(async (cardId: string, settings: Record<string, unknown> = {}) => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/added-analyses`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId, settings }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { items: AnalysisListItem[] };
    setState((s) => ({ ...s, items: json.items }));
  }, [projectId]);

  const remove = useCallback(async (cardId: string, addedAt: string) => {
    if (!projectId) return;
    const res = await fetch(
      `/api/projects/${projectId}/added-analyses?cardId=${encodeURIComponent(cardId)}&addedAt=${encodeURIComponent(addedAt)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { items: AnalysisListItem[] };
    setState((s) => ({ ...s, items: json.items }));
  }, [projectId]);

  const updateSettings = useCallback(async (cardId: string, addedAt: string, settings: Record<string, unknown>) => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}/added-analyses`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId, addedAt, settings }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { items: AnalysisListItem[] };
    setState((s) => ({ ...s, items: json.items }));
  }, [projectId]);

  return { ...state, refresh, add, remove, updateSettings };
}
