"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";

type VelocityPayload = {
  changepoints: number[];
  n_breaks: number;
  min_size: number;
};

type DispatchEnvelope = {
  data?: { payload: VelocityPayload; computedAt: string } | null;
  computedAt?: string;
};

export function VelocityLineCI({ projectId }: { projectId?: string }) {
  const [r, setR] = useState<VelocityPayload | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let cancelled = false;
    fetch(`/api/projects/${projectId}/analyses/A25_velocity`, { signal: ac.signal })
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

  if (!r) return null;
  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="Velocity change-points"
        denominatorLabel={`PELT · min_size=${r.min_size}`}
        lastUpdated={computedAt ?? undefined}
      />
      <div className="font-display text-[18px] font-extrabold tabular-nums">{r.n_breaks}</div>
      <div className="mt-1 font-mono text-[10.5px] text-[var(--shell-text-muted)]">
        {r.n_breaks === 0
          ? "no significant regime changes detected"
          : `breaks at day${r.n_breaks > 1 ? "s" : ""} ${r.changepoints.join(", ")}`}
      </div>
    </div>
  );
}
