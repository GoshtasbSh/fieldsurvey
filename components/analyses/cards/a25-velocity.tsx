"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { AwaitingDataPanel } from "@/components/analyses/awaiting-data-panel";

type VelocityPayload = {
  changepoints: number[];
  n_breaks: number;
  min_size: number;
};

type DispatchEnvelope = {
  data?: { payload: VelocityPayload; computedAt: string } | null;
  computedAt?: string;
  status?: string;
};

type Status = "loading" | "ready" | "sidecar-pending";

export function VelocityLineCI({ projectId }: { projectId?: string }) {
  const [r, setR] = useState<VelocityPayload | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");

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

  if (status === "sidecar-pending" || !r) {
    return (
      <AwaitingDataPanel
        cardName="Velocity + change-points"
        cardId="A25_velocity"
        reason="sidecar-pending"
      />
    );
  }
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
