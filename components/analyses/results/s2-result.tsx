// components/analyses/results/s2-result.tsx
"use client";
type S2Result = { n_hot: number; n_cold: number; n_ns: number; fdr_cutoff: number; n: number };
export function S2Result({ data }: { data: unknown }) {
  const r = data as S2Result;
  if (r?.n_hot === undefined) return null;
  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-[11.5px]">
        <span className="text-red-400 font-semibold">{r.n_hot} hot</span>
        <span className="text-blue-400 font-semibold">{r.n_cold} cold</span>
        <span className="text-[var(--shell-text-muted)]">{r.n_ns} n.s.</span>
      </div>
      <p className="text-[10px] text-[var(--shell-text-muted)]">FDR cutoff: {r.fdr_cutoff.toFixed(5)} · n = {r.n}</p>
    </div>
  );
}
