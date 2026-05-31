"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { NMinPlaceholder } from "../n-min-placeholder";

type Props = { projectId?: string; columnKey?: string; userRole?: string | null };

export function HistogramBoxplot({ projectId, columnKey }: Props) {
  const [nums, setNums] = useState<number[]>([]);
  useEffect(() => {
    if (!projectId || !columnKey) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/columns/${encodeURIComponent(columnKey)}`)
      .then((r) => r.json())
      .then((r) => {
        if (cancelled) return;
        const arr = Object.values(r?.valuesByResponseId ?? {})
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n));
        setNums(arr);
      })
      .catch(() => {
        if (cancelled) return;
        setNums([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, columnKey]);

  if (!projectId || !columnKey) return null;
  if (nums.length < 30) return <NMinPlaceholder cardName="Numeric summary" n={nums.length} nMin={30} />;
  const sorted = [...nums].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = q(0.5);
  const p25 = q(0.25);
  const p75 = q(0.75);
  const bins = 20;
  const w = (max - min) / bins || 1;
  const hist = new Array(bins).fill(0) as number[];
  for (const v of nums) {
    const i = Math.min(bins - 1, Math.floor((v - min) / w));
    hist[i]++;
  }
  const hmax = Math.max(...hist);
  return (
    <div className="bento-panel p-4">
      <TrustChrome cardName={`Numeric · ${columnKey}`} n={nums.length} denominatorLabel="responses" />
      <div className="flex h-12 items-end gap-px">
        {hist.map((h, i) => <div key={i} className="flex-1 bg-[var(--shell-text-muted)]" style={{ height: `${(h / hmax) * 100}%` }} />)}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-2 text-center text-[10.5px]">
        <div><div className="font-mono tabular-nums">{median.toFixed(1)}</div><div className="text-[9px] text-[var(--shell-text-muted)]">median</div></div>
        <div><div className="font-mono tabular-nums">{(p75 - p25).toFixed(1)}</div><div className="text-[9px] text-[var(--shell-text-muted)]">IQR</div></div>
        <div><div className="font-mono tabular-nums">{min.toFixed(1)}–{max.toFixed(1)}</div><div className="text-[9px] text-[var(--shell-text-muted)]">range</div></div>
      </div>
    </div>
  );
}
