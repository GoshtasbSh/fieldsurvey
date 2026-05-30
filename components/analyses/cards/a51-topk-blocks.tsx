"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { NMinPlaceholder } from "../n-min-placeholder";
import type { TopKBlockRow } from "@/lib/queries/topk-blocks";

/**
 * A51 — top-K parcels to revisit, ranked by composite score.
 *
 * Compact list view: short parcel ID, achieved %, raw score badge. The
 * score is opaque to end users (admin uses it as an ordering hint, not a
 * directly-interpretable metric) — we render it muted to keep visual
 * weight on the achieved % bar.
 *
 * n_min is 3 ranked parcels — fewer and the "top K" framing is pointless.
 */
const N_MIN = 3;

export function TopKBlocks({ projectId }: { projectId?: string }) {
  const [rows, setRows] = useState<TopKBlockRow[] | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/analyses/a51-topk-blocks`,
          { signal: ac.signal },
        );
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setRows((json?.data ?? null) as TopKBlockRow[] | null);
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
    return <NMinPlaceholder cardName="Top revisit candidates" n={rows.length} nMin={N_MIN} />;
  }

  return (
    <div className="bento-panel p-4">
      <TrustChrome
        cardName="Top revisit candidates"
        n={rows.length}
        denominatorLabel="ranked parcels"
      />
      <ol className="space-y-1">
        {rows.map((r, i) => {
          const ach = Number(r.achieved_pct ?? 0);
          return (
            <li
              key={r.block_geoid}
              className="flex items-center gap-1.5 rounded bg-[var(--shell-2)] px-2 py-1 text-[10.5px]"
            >
              <span className="w-4 text-right font-mono text-[9px] text-[var(--shell-text-muted)]">
                {i + 1}.
              </span>
              <span
                className="truncate font-mono text-[9.5px]"
                style={{ width: 60 }}
                title={r.block_geoid}
              >
                {r.block_geoid.slice(0, 8)}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--shell-3)]">
                <div
                  className="h-full rounded-full bg-[var(--shell-text-muted)]"
                  style={{ width: `${Math.min(100, ach)}%` }}
                />
              </div>
              <span className="w-10 text-right font-mono tabular-nums">{ach.toFixed(0)}%</span>
              <span className="w-12 text-right font-mono tabular-nums text-[9px] text-[var(--shell-text-muted)]">
                ◆{Number(r.score).toFixed(0)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
