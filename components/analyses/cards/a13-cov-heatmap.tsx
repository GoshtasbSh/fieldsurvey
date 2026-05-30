"use client";
import { useEffect, useMemo, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { NMinPlaceholder } from "../n-min-placeholder";
import type { CoverageRow } from "@/lib/queries/universe-coverage";

/**
 * A13 — coverage vs universe summary.
 *
 * The full per-parcel choropleth lives in the desktop map shell. This card
 * is the analyze-tab summary: system-wide coverage % + a worst-5 ranked
 * list so admins can see hotspots that drag the overall number down.
 *
 * n_min is 5 parcels with universe ≥ 5 (matches the implicit RPC filter
 * we apply below — we ignore parcels with tiny universes to avoid noise).
 */
const N_MIN = 5;
const WORST_K = 5;

export function RateChoropleth({ projectId }: { projectId?: string }) {
  const [rows, setRows] = useState<CoverageRow[] | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/analyses/a13-cov-heatmap`,
          { signal: ac.signal },
        );
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setRows((json?.data ?? null) as CoverageRow[] | null);
      } catch {
        // dispatcher not wired yet
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [projectId]);

  const filtered = useMemo(
    () => (rows ?? []).filter((r) => (r.universe_addresses ?? 0) >= 5),
    [rows],
  );

  const systemPct = useMemo(() => {
    if (filtered.length === 0) return null;
    const u = filtered.reduce((s, r) => s + (r.universe_addresses ?? 0), 0);
    const p = filtered.reduce(
      (s, r) => s + Math.min(r.points_collected ?? 0, r.universe_addresses ?? 0),
      0,
    );
    return u > 0 ? (p / u) * 100 : null;
  }, [filtered]);

  const worst = useMemo(() => {
    return [...filtered]
      .map((r) => ({
        ...r,
        pct: r.universe_addresses > 0
          ? ((r.points_collected ?? 0) / r.universe_addresses) * 100
          : 0,
      }))
      .sort((a, z) => a.pct - z.pct)
      .slice(0, WORST_K);
  }, [filtered]);

  if (rows === null) return null;
  if (filtered.length < N_MIN) {
    return <NMinPlaceholder cardName="Coverage vs universe" n={filtered.length} nMin={N_MIN} />;
  }

  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="Coverage vs universe"
        n={filtered.length}
        denominatorLabel="parcels"
      />
      <div className="mb-3 rounded-lg bg-[var(--shell-2)] p-3 text-center">
        <div className="font-mono text-[9.5px] uppercase text-[var(--shell-text-muted)]">system-wide</div>
        <div className="font-display text-[22px] font-extrabold tabular-nums">
          {systemPct != null ? `${systemPct.toFixed(1)}%` : "—"}
        </div>
      </div>
      <div className="mb-1 font-mono text-[9.5px] uppercase text-[var(--shell-text-muted)]">
        worst {worst.length}
      </div>
      <ul className="space-y-1">
        {worst.map((r) => (
          <li key={r.block_geoid} className="flex items-center gap-1.5 text-[10.5px]">
            <div
              className="truncate font-mono text-[9px] text-[var(--shell-text-muted)]"
              style={{ width: 56 }}
              title={r.block_geoid}
            >
              {r.block_geoid.slice(0, 8)}
            </div>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--shell-3)]">
              <div
                className="h-full rounded-full bg-[var(--shell-text-muted)]"
                style={{ width: `${Math.min(100, r.pct)}%` }}
              />
            </div>
            <div className="w-10 text-right font-mono tabular-nums">{r.pct.toFixed(0)}%</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
