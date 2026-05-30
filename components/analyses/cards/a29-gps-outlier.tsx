"use client";
import { useEffect, useMemo, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { NMinPlaceholder } from "../n-min-placeholder";
import type { GpsOutlierRow } from "@/lib/queries/productivity";

/**
 * A29 — GPS accuracy outliers (admin).
 *
 * Per-surveyor row showing median accuracy as a bar (lower = better) and
 * a flagged-count tile for points exceeding the 50m threshold. Acts as a
 * QC indicator for crowd-sourced field positioning.
 *
 * n_min is 30 *points* across all surveyors (less than that and median
 * accuracy is dominated by individual sensor jitter).
 */
const N_MIN = 30;
const THRESH_M = 50;

export function GpsOutlierBox({ projectId }: { projectId?: string }) {
  const [rows, setRows] = useState<GpsOutlierRow[] | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/analyses/A29_gps_outlier`,
          { signal: ac.signal },
        );
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setRows((json?.data ?? null) as GpsOutlierRow[] | null);
      } catch {
        // dispatcher not wired yet
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [projectId]);

  const totalPoints = useMemo(
    () => (rows ?? []).reduce((s, r) => s + (Number(r.total) || 0), 0),
    [rows],
  );
  const maxMedian = useMemo(
    () => Math.max(THRESH_M, ...(rows ?? []).map((r) => Number(r.median_acc) || 0)),
    [rows],
  );

  if (rows === null) return null;
  if (totalPoints < N_MIN) {
    return <NMinPlaceholder cardName="GPS accuracy" n={totalPoints} nMin={N_MIN} />;
  }

  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="GPS accuracy outliers"
        n={totalPoints}
        denominatorLabel={`flag > ${THRESH_M}m`}
      />
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const median = Number(r.median_acc) || 0;
          const widthPct = (median / maxMedian) * 100;
          const threshPct = (THRESH_M / maxMedian) * 100;
          return (
            <li key={r.collector_id} className="flex items-center gap-2 text-[10.5px]">
              <div className="w-24 truncate" title={r.name}>{r.name}</div>
              <div className="relative h-2 flex-1 overflow-hidden rounded-sm bg-[var(--shell-3)]">
                <div
                  className="absolute inset-y-0 left-0 rounded-sm bg-[var(--shell-text-muted)]"
                  style={{ width: `${widthPct}%` }}
                />
                <div
                  className="absolute inset-y-0 w-px bg-[var(--shell-accent,white)]"
                  style={{ left: `${threshPct}%` }}
                  aria-label={`${THRESH_M}m threshold`}
                />
              </div>
              <div className="w-12 text-right font-mono tabular-nums">{median.toFixed(0)}m</div>
              <div
                className={`w-12 text-right font-mono tabular-nums text-[9.5px] ${
                  Number(r.flagged) > 0
                    ? "text-[var(--shell-text)]"
                    : "text-[var(--shell-text-muted)]"
                }`}
              >
                {r.flagged}/{r.total}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
