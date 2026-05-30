"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";

type Fan = {
  p50_days: number | null;
  p75_days: number | null;
  p90_days: number | null;
  p50_date: string | null;
  p75_date: string | null;
  p90_date: string | null;
  sims: number;
  history_window: number;
};

type DispatchEnvelope = {
  data?: { payload: Fan; computedAt: string } | null;
  computedAt?: string;
};

export function MonteCarloFan({ projectId }: { projectId?: string }) {
  const [r, setR] = useState<Fan | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let cancelled = false;
    fetch(`/api/projects/${projectId}/analyses/A21_finish`, { signal: ac.signal })
      .then((res) => res.json())
      .then((j: DispatchEnvelope) => {
        if (cancelled) return;
        if (j.data && j.data.payload) {
          setR(j.data.payload);
          setComputedAt(j.data.computedAt ?? j.computedAt ?? null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [projectId]);

  if (!r || r.p50_days == null) return null;
  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="Predicted finish date"
        methodHref="#"
        denominatorLabel={`${r.sims.toLocaleString()} sims · ${r.history_window}d history`}
        lastUpdated={computedAt ?? undefined}
      />
      <div className="font-display text-[18px] font-extrabold tabular-nums">{r.p75_date}</div>
      <div className="mt-1 font-mono text-[10.5px] text-[var(--shell-text-muted)]">
        @ 75% confidence · range {r.p50_date} → {r.p90_date}
      </div>
    </div>
  );
}
