"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";

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
};

/**
 * Placeholder card for the KDE raster. The actual heatmap overlay lives on
 * the map shell (lit by `kde-layer.ts` when `view.kde_enabled` is set). Here
 * we just surface the metadata so analysts see when the raster was computed.
 */
export function KdeRaster({ projectId }: { projectId?: string }) {
  const [r, setR] = useState<KdePayload | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/analyses/A11_kde`)
      .then((res) => res.json())
      .then((j: DispatchEnvelope) => {
        if (j.data && j.data.payload) {
          setR(j.data.payload);
          setComputedAt(j.data.computedAt ?? j.computedAt ?? null);
        }
      })
      .catch(() => {});
  }, [projectId]);

  if (!r || r.n === 0) return null;
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
