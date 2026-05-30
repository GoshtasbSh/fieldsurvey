"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { NMinPlaceholder } from "../n-min-placeholder";
import type { UndersampledRow } from "@/lib/queries/universe-coverage";

/**
 * A20 — under-sampled parcels bullet chart.
 *
 * Each row is a bullet: target line (70% by default) on a 0–100% track
 * with the achieved % filled in. Parcels are already sorted descending by
 * gap from the RPC so the worst offenders sit at the top.
 *
 * n_min is 5 parcels with universe ≥ 5 (matches RPC filter).
 */
const N_MIN = 5;
const TARGET_PCT = 70;

export function RankedBullet({ projectId }: { projectId?: string }) {
  const [rows, setRows] = useState<UndersampledRow[] | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/analyses/a20-undersampled`,
          { signal: ac.signal },
        );
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setRows((json?.data ?? null) as UndersampledRow[] | null);
      } catch {
        // dispatcher not wired yet
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [projectId]);

  if (rows === null) return null;
  if (rows.length < N_MIN) {
    return <NMinPlaceholder cardName="Under-sampled parcels" n={rows.length} nMin={N_MIN} />;
  }
  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="Under-sampled parcels"
        n={rows.length}
        denominatorLabel={`target ${TARGET_PCT}%`}
      />
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <BulletRow key={r.block_geoid} row={r} />
        ))}
      </ul>
    </div>
  );
}

function BulletRow({ row }: { row: UndersampledRow }) {
  const achieved = Math.max(0, Math.min(100, Number(row.achieved_pct ?? 0)));
  const label = row.block_geoid.slice(0, 8);
  return (
    <li className="flex items-center gap-2 text-[10.5px]">
      <div className="w-16 truncate font-mono text-[9.5px] text-[var(--shell-text-muted)]" title={row.block_geoid}>
        {label}
      </div>
      <div className="relative h-2 flex-1 overflow-hidden rounded-sm bg-[var(--shell-3)]">
        <div
          className="absolute inset-y-0 left-0 rounded-sm bg-[var(--shell-text-muted)]"
          style={{ width: `${achieved}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-[var(--shell-accent,white)]"
          style={{ left: `${TARGET_PCT}%` }}
          aria-label={`target ${TARGET_PCT}%`}
        />
      </div>
      <div className="w-10 text-right font-mono tabular-nums">{achieved.toFixed(0)}%</div>
      <div className="w-8 text-right font-mono tabular-nums text-[9.5px] text-[var(--shell-text-muted)]">
        n={row.universe_addresses}
      </div>
    </li>
  );
}
