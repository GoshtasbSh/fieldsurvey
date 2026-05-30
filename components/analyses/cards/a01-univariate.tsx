"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { wilsonInterval } from "@/lib/analyses/formulas/wilson";
import { NMinPlaceholder } from "../n-min-placeholder";

type Props = { projectId?: string; columnKey?: string; userRole?: string | null };

export function DivergingBar({ projectId, columnKey }: Props) {
  const [counts, setCounts] = useState<{ value: string; n: number }[]>([]);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (!projectId || !columnKey) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/columns/${encodeURIComponent(columnKey)}`)
      .then((r) => r.json())
      .then((r) => {
        if (cancelled) return;
        const tally = new Map<string, number>();
        for (const v of Object.values(r?.valuesByResponseId ?? {})) {
          const k = v == null || v === "" ? "—" : String(v);
          tally.set(k, (tally.get(k) ?? 0) + 1);
        }
        const arr = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, n }));
        setCounts(arr);
        setTotal(arr.reduce((a, b) => a + b.n, 0));
      })
      .catch(() => {
        if (cancelled) return;
        setCounts([]);
        setTotal(0);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, columnKey]);

  if (!projectId || !columnKey) return null;
  if (total < 30) return <NMinPlaceholder cardName="Univariate distribution" n={total} nMin={30} />;
  const max = Math.max(1, ...counts.map((c) => c.n));
  return (
    <div className="bento-panel p-4">
      <TrustChrome cardName={`Univariate · ${columnKey}`} n={total} denominatorLabel="responses" />
      <div className="space-y-1">
        {counts.slice(0, 12).map((c) => {
          const { low, high } = wilsonInterval(c.n, total);
          return (
            <div key={c.value} className="grid grid-cols-[80px_1fr_50px] items-center gap-2">
              <div className="truncate text-[11px]">{c.value}</div>
              <div className="h-1.5 rounded-full bg-[var(--shell-3)]"><div className="h-full rounded-full bg-[var(--shell-text-muted)]" style={{ width: `${(c.n / max) * 100}%` }} /></div>
              <div className="font-mono text-[10px] text-right tabular-nums">{c.n} ±{Math.round(((high - low) / 2) * 100)}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
