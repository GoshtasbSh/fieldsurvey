"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { AwaitingDataPanel } from "@/components/analyses/awaiting-data-panel";

type KdePayload = {
  grid: number[][] | number[];
  values: number[];
  bandwidth: number;
  grid_size: number;
  n: number;
};

type DispatchEnvelope = {
  data?: { payload: KdePayload; computedAt: string } | null;
  computedAt?: string;
  status?: string;
};

type Status = "loading" | "ready" | "sidecar-pending";

/**
 * Placeholder card for the KDE raster. The actual heatmap overlay lives on
 * the map shell (lit by `kde-layer.ts` when `view.kde_enabled` is set). Here
 * we just surface the metadata so analysts see when the raster was computed.
 */
export function KdeRaster({ projectId }: { projectId?: string }) {
  const [r, setR] = useState<KdePayload | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let cancelled = false;
    fetch(`/api/projects/${projectId}/analyses/A11_kde`, { signal: ac.signal })
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

  if (status === "sidecar-pending" || !r || r.n === 0) {
    return (
      <AwaitingDataPanel
        cardName="KDE heatmap"
        cardId="A11_kde"
        reason="sidecar-pending"
      />
    );
  }
  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="KDE density"
        denominatorLabel={`bw=${r.bandwidth} · grid ${r.grid_size}×${r.grid_size}`}
        n={r.n}
        lastUpdated={computedAt ?? undefined}
      />
      <div className="font-mono text-[10.5px] text-[var(--shell-text-muted)]">
        raster ready · toggle the Density layer on the map to display
      </div>
    </div>
  );
}
