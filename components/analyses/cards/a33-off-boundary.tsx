"use client";
import { useEffect, useMemo, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { AwaitingDataPanel } from "@/components/analyses/awaiting-data-panel";
import type { OffBoundaryRow } from "@/lib/queries/off-boundary";

/**
 * A33 — off-boundary stops (admin QC).
 *
 * Flag tile ("N points off boundary by avg X m") plus a numbered list of
 * the worst offenders sorted by distance. No n_min suppression — even a
 * single off-boundary point is actionable for a project manager. When
 * the RPC returns zero rows we render a clean "all in bounds" state.
 *
 * The numbered list cross-references with the map shell: clicking a row
 * pans the map to that point (wiring TBD in Batch 5 when the dispatcher
 * lands and the map shell knows which IDs to highlight).
 */
const LIST_LIMIT = 8;

export function OffBoundaryMapList({ projectId }: { projectId?: string }) {
  const [rows, setRows] = useState<OffBoundaryRow[] | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/analyses/A33_off_boundary`,
          { signal: ac.signal },
        );
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setRows((json?.data ?? null) as OffBoundaryRow[] | null);
      } catch {
        // dispatcher not wired yet
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [projectId]);

  const sorted = useMemo(
    () =>
      [...(rows ?? [])].sort(
        (a, z) => Number(z.distance_m ?? 0) - Number(a.distance_m ?? 0),
      ),
    [rows],
  );
  const avgDist = useMemo(() => {
    if (!rows || rows.length === 0) return 0;
    const sum = rows.reduce((s, r) => s + (Number(r.distance_m) || 0), 0);
    return sum / rows.length;
  }, [rows]);

  if (rows === null) {
    return (
      <AwaitingDataPanel
        cardName="Off-boundary stops"
        cardId="A33_off_boundary"
        reason="needs-boundary"
      />
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bento-panel p-4">
        <TrustChrome cardName="Off-boundary stops" n={0} />
        <div className="rounded-lg bg-[var(--shell-2)] p-3 text-center text-[11px] text-[var(--shell-text-muted)]">
          All collected points within project boundary.
        </div>
      </div>
    );
  }

  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="Off-boundary stops"
        n={rows.length}
        denominatorLabel={`avg ${avgDist.toFixed(0)}m off`}
      />
      <div className="mb-2 rounded-lg bg-[var(--shell-2)] p-3 text-center">
        <div className="font-display text-[22px] font-extrabold tabular-nums">
          {rows.length}
        </div>
        <div className="font-mono text-[9.5px] uppercase text-[var(--shell-text-muted)]">
          off-boundary · avg {avgDist.toFixed(0)}m
        </div>
      </div>
      <ol className="space-y-1 font-mono text-[10px]">
        {sorted.slice(0, LIST_LIMIT).map((r, i) => (
          <li
            key={r.id}
            className="flex items-center gap-2 rounded bg-[var(--shell-2)] px-2 py-1"
          >
            <span className="w-4 text-right text-[var(--shell-text-muted)]">{i + 1}.</span>
            <span className="flex-1 truncate" title={`${r.lat}, ${r.lon}`}>
              {Number(r.lat).toFixed(4)}, {Number(r.lon).toFixed(4)}
            </span>
            <span className="tabular-nums">{Number(r.distance_m).toFixed(0)}m</span>
          </li>
        ))}
        {sorted.length > LIST_LIMIT && (
          <li className="px-2 py-1 text-center text-[9.5px] text-[var(--shell-text-muted)]">
            +{sorted.length - LIST_LIMIT} more
          </li>
        )}
      </ol>
    </div>
  );
}
