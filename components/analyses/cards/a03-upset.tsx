"use client";
import { useEffect, useState } from "react";
import { TrustChrome } from "../trust-chrome";
import { NMinPlaceholder } from "../n-min-placeholder";

type Props = { projectId?: string; columnKey?: string; userRole?: string | null };

export function UpSetPlot({ projectId, columnKey }: Props) {
  const [resp, setResp] = useState<string[][]>([]);
  useEffect(() => {
    if (!projectId || !columnKey) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/columns/${encodeURIComponent(columnKey)}`)
      .then((r) => r.json())
      .then((r) => {
        if (cancelled) return;
        const parsed = Object.values(r?.valuesByResponseId ?? {})
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.split(/[,;|]/).map((s) => s.trim()).filter(Boolean));
        setResp(parsed);
      })
      .catch(() => {
        if (cancelled) return;
        setResp([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, columnKey]);

  if (!projectId || !columnKey) return null;
  if (resp.length < 100) return <NMinPlaceholder cardName="Multi-select co-occurrence" n={resp.length} nMin={100} />;
  const freq = new Map<string, number>();
  for (const arr of resp) for (const o of arr) freq.set(o, (freq.get(o) ?? 0) + 1);
  const opts = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const combos = new Map<string, number>();
  for (const arr of resp) {
    const key = [...new Set(arr.filter((o) => opts.some(([k]) => k === o)))].sort().join("+");
    if (!key) continue;
    combos.set(key, (combos.get(key) ?? 0) + 1);
  }
  const top = [...combos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <div className="bento-panel p-4">
      <TrustChrome cardName={`Multi-select · ${columnKey}`} n={resp.length} denominatorLabel="respondents" />
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">Option frequency</div>
      <div className="mb-3 space-y-1">
        {opts.map(([opt, n]) => (
          <div key={opt} className="grid grid-cols-[80px_1fr_30px] items-center gap-2">
            <div className="truncate text-[11px]">{opt}</div>
            <div className="h-1.5 rounded-full bg-[var(--shell-3)]"><div className="h-full bg-[var(--shell-text-muted)] rounded-full" style={{ width: `${(n / resp.length) * 100}%` }} /></div>
            <div className="font-mono text-[10px] text-right tabular-nums">{Math.round((n / resp.length) * 100)}%</div>
          </div>
        ))}
      </div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">Top combinations</div>
      <div className="space-y-1">
        {top.map(([k, n]) => (
          <div key={k} className="flex items-center justify-between text-[10.5px]">
            <span className="truncate">{k}</span>
            <span className="font-mono">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
