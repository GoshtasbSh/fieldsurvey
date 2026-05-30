"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";

type GiStarResult = { id: string; z: number; p: number };

type GiStarPayload = {
  results: GiStarResult[];
  k: number;
  n: number;
  permutations: number;
};

type DispatchEnvelope = {
  data?: { payload: GiStarPayload; computedAt: string } | null;
  computedAt?: string;
};

/**
 * Placeholder list of the top significant cells. The actual choropleth lives
 * on the map shell via the `gi-star-layer.ts` symbology. Here we surface the
 * counts so analysts know the model converged and how many cells are
 * significant at FDR 5%.
 */
export function SignificanceChoropleth({ projectId }: { projectId?: string }) {
  const [r, setR] = useState<GiStarPayload | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let cancelled = false;
    fetch(`/api/projects/${projectId}/analyses/A8_gi_star`, { signal: ac.signal })
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

  if (!r || r.n < 30) return null;

  const sigCount = r.results.filter((c) => c.p < 0.05).length;
  const top = [...r.results]
    .filter((c) => c.p < 0.05)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, 5);

  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="Hotspots (Getis-Ord Gi*)"
        denominatorLabel={`k=${r.k} · ${r.permutations} perms · FDR≤5%`}
        n={r.n}
        lastUpdated={computedAt ?? undefined}
      />
      <div className="font-display text-[18px] font-extrabold tabular-nums">{sigCount}</div>
      <div className="mt-1 mb-2 font-mono text-[10.5px] text-[var(--shell-text-muted)]">
        significant cells of {r.n} (FDR 5%)
      </div>
      <div className="space-y-1">
        {top.map((c) => (
          <div key={c.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-[10.5px]">
            <span className="font-mono truncate text-[var(--shell-text-muted)]">{c.id}</span>
            <span className="font-mono tabular-nums">z={c.z.toFixed(2)}</span>
            <span className="font-mono tabular-nums text-[var(--shell-text-muted)]">p={c.p.toFixed(3)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
