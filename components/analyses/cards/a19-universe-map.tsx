"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { NMinPlaceholder } from "../n-min-placeholder";
import type { CoverageRow } from "@/lib/queries/universe-coverage";

/**
 * A19 — universe penetration KPI tile.
 *
 * The full choropleth lives in the desktop map shell. This card is the
 * summary block: "X% of N addresses touched", plus a coarse 4-bucket
 * coverage breakdown (0%, 1-25%, 26-75%, 76-100%) so admins can see at a
 * glance how many parcels are barely-touched vs nearly-done.
 *
 * n_min is 50 *universe addresses* (parcel rows count too few to reason
 * about coverage when the address pool is tiny).
 */
const N_MIN = 50;

export function UniverseMap({ projectId }: { projectId?: string }) {
  const [rows, setRows] = useState<CoverageRow[] | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/analyses/A19_universe_map`,
          { signal: ac.signal },
        );
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setRows((json?.data ?? null) as CoverageRow[] | null);
      } catch {
        // dispatcher not wired yet — silent null state
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [projectId]);

  if (rows === null) return null;
  const totalUniverse = rows.reduce((s, r) => s + (r.universe_addresses ?? 0), 0);
  if (totalUniverse < N_MIN) {
    return <NMinPlaceholder cardName="Universe penetration" n={totalUniverse} nMin={N_MIN} />;
  }
  const totalTouched = rows.reduce(
    (s, r) => s + Math.min(r.points_collected ?? 0, r.universe_addresses ?? 0),
    0,
  );
  const penetrationPct = (totalTouched / totalUniverse) * 100;

  // Bucket parcels by achieved %.
  const buckets = { zero: 0, low: 0, mid: 0, high: 0 };
  for (const r of rows) {
    if ((r.universe_addresses ?? 0) <= 0) continue;
    const pct = ((r.points_collected ?? 0) / r.universe_addresses) * 100;
    if (pct <= 0) buckets.zero++;
    else if (pct <= 25) buckets.low++;
    else if (pct <= 75) buckets.mid++;
    else buckets.high++;
  }

  return (
    <div className="bento-panel p-4">
      <TrustChrome cardName="Universe penetration" n={totalUniverse} denominatorLabel="universe addrs" />
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-[var(--shell-2)] p-3 text-center">
          <div className="font-mono text-[9.5px] uppercase text-[var(--shell-text-muted)]">touched</div>
          <div className="font-display text-[22px] font-extrabold tabular-nums">{penetrationPct.toFixed(1)}%</div>
          <div className="font-mono text-[9.5px] text-[var(--shell-text-muted)]">
            {totalTouched.toLocaleString()} / {totalUniverse.toLocaleString()}
          </div>
        </div>
        <div className="space-y-1">
          <BucketRow label="0%"     n={buckets.zero} total={rows.length} />
          <BucketRow label="1–25%"  n={buckets.low}  total={rows.length} />
          <BucketRow label="26–75%" n={buckets.mid}  total={rows.length} />
          <BucketRow label="76–100%" n={buckets.high} total={rows.length} />
        </div>
      </div>
    </div>
  );
}

function BucketRow({ label, n, total }: { label: string; n: number; total: number }) {
  const pct = total > 0 ? (n / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-[10.5px]">
      <div className="w-14 font-mono text-[9.5px] text-[var(--shell-text-muted)]">{label}</div>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--shell-3)]">
        <div className="h-full rounded-full bg-[var(--shell-text-muted)]" style={{ width: `${pct}%` }} />
      </div>
      <div className="w-7 text-right font-mono tabular-nums text-[9.5px]">{n}</div>
    </div>
  );
}
