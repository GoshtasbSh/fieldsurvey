// components/analyses/results/s7-result.tsx
"use client";
type S7Result = { n_pos_autocorr: number; n_neg_autocorr: number; n_ns: number; fdr_cutoff: number; n: number; winsorized: boolean };
export function S7Result({ data }: { data: unknown }) {
  const r = data as S7Result;
  if (r?.n_pos_autocorr === undefined) return null;
  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-[11.5px]">
        <span className="text-teal-400 font-semibold">{r.n_pos_autocorr} agree with neighbors</span>
        <span className="text-pink-400 font-semibold">{r.n_neg_autocorr} heterogeneous</span>
      </div>
      <p className="text-[10px] text-[var(--shell-text-muted)]">
        {r.n_ns} n.s. · FDR {r.fdr_cutoff.toFixed(5)} · {r.winsorized ? "winsorized" : "raw"}
      </p>
    </div>
  );
}
