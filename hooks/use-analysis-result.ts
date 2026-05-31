// hooks/use-analysis-result.ts
"use client";
import { useCallback, useState } from "react";

type ResultState = {
  data: unknown | null;
  loading: boolean;
  error: string | null;
  computedAt: string | null;
};

/**
 * On-demand hook: call run() to fetch an analysis result from the dispatcher.
 * Does NOT auto-fetch on mount — the user must click "Run analysis".
 */
export function useAnalysisResult(
  projectId: string,
  cardId: string,
  settings: Record<string, unknown>,
) {
  const [state, setState] = useState<ResultState>({
    data: null, loading: false, error: null, computedAt: null,
  });

  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      // Build query string from settings for dispatcher routing
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(settings)) {
        if (v !== null && v !== undefined) params.set(k, String(v));
      }
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/projects/${projectId}/analyses/${cardId}${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const env = (await res.json()) as { data?: unknown | null; computedAt?: string | null };
      setState({ data: env?.data ?? null, loading: false, error: null, computedAt: env?.computedAt ?? null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }, [projectId, cardId, settings]);

  return { ...state, run };
}
