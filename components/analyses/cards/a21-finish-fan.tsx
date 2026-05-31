"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { AwaitingDataPanel } from "@/components/analyses/awaiting-data-panel";

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
  status?: string;
};

type Status = "loading" | "ready" | "sidecar-pending";

export function MonteCarloFan({ projectId }: { projectId?: string }) {
  const [r, setR] = useState<Fan | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");

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
          setStatus("ready");
        } else {
          setStatus("sidecar-pending");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("sidecar-pending");
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [projectId]);

  if (status === "sidecar-pending" || !r || r.p50_days == null) {
    return (
      <AwaitingDataPanel
        cardName="Predicted finish date"
        cardId="A21_finish"
        reason="sidecar-pending"
      />
    );
  }
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
