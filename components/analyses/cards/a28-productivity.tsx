"use client";
import { useEffect, useMemo, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { NMinPlaceholder } from "../n-min-placeholder";
import type { ProductivityRow } from "@/lib/queries/productivity";

/**
 * A28 — productivity bullet chart (admin).
 *
 * One row per surveyor. The "target" line is the team median ppshift so
 * outliers in either direction stand out (slow surveyors below, top
 * performers above). RPC already filters to surveyors with ≥3 shifts.
 *
 * n_min is 3 surveyors — fewer and the median is meaningless.
 */
const N_MIN = 3;

export function ProductivityBullet({ projectId }: { projectId?: string }) {
  const [rows, setRows] = useState<ProductivityRow[] | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/analyses/A28_productivity`,
          { signal: ac.signal },
        );
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setRows((json?.data ?? null) as ProductivityRow[] | null);
      } catch {
        // dispatcher not wired yet
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [projectId]);

  const { median, maxPpShift } = useMemo(() => {
    if (!rows || rows.length === 0) return { median: 0, maxPpShift: 1 };
    const vals = rows.map((r) => Number(r.ppshift) || 0).sort((a, z) => a - z);
    const m = vals[Math.floor(vals.length / 2)];
    return { median: m, maxPpShift: Math.max(1, ...vals) };
  }, [rows]);

  if (rows === null) return null;
  if (rows.length < N_MIN) {
    return <NMinPlaceholder cardName="Productivity per surveyor" n={rows.length} nMin={N_MIN} />;
  }

  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="Productivity per surveyor"
        n={rows.length}
        denominatorLabel={`median ${median.toFixed(1)}/shift`}
      />
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <ProductivityRowItem
            key={r.collector_id}
            row={r}
            scaleMax={Math.max(maxPpShift, median * 1.5)}
            median={median}
          />
        ))}
      </ul>
    </div>
  );
}

function ProductivityRowItem({
  row,
  scaleMax,
  median,
}: {
  row: ProductivityRow;
  scaleMax: number;
  median: number;
}) {
  const ppshift = Number(row.ppshift) || 0;
  const widthPct = scaleMax > 0 ? (ppshift / scaleMax) * 100 : 0;
  const medianPct = scaleMax > 0 ? (median / scaleMax) * 100 : 0;
  return (
    <li className="flex items-center gap-2 text-[10.5px]">
      <div className="w-24 truncate" title={row.name}>{row.name}</div>
      <div className="relative h-2 flex-1 overflow-hidden rounded-sm bg-[var(--shell-3)]">
        <div
          className="absolute inset-y-0 left-0 rounded-sm bg-[var(--shell-text-muted)]"
          style={{ width: `${widthPct}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-[var(--shell-accent,white)]"
          style={{ left: `${medianPct}%` }}
          aria-label={`team median ${median.toFixed(1)}`}
        />
      </div>
      <div className="w-12 text-right font-mono tabular-nums">{ppshift.toFixed(1)}</div>
      <div className="w-12 text-right font-mono tabular-nums text-[9.5px] text-[var(--shell-text-muted)]">
        {row.shifts}sh
      </div>
    </li>
  );
}
