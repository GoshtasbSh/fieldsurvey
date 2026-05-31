// components/analyses/results/s3-result.tsx
"use client";
type S3Result = { n_HH: number; n_LL: number; n_HL: number; n_LH: number; n_ns: number; fdr_cutoff: number; n: number };
export function S3Result({ data }: { data: unknown }) {
  const r = data as S3Result;
  if (r?.n_HH === undefined) return null;
  const sig = r.n_HH + r.n_LL + r.n_HL + r.n_LH;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1 text-[11px]">
        <div className="rounded bg-red-500/20 p-1 text-center"><span className="font-mono font-bold text-red-400">HH</span> {r.n_HH}</div>
        <div className="rounded bg-orange-400/20 p-1 text-center"><span className="font-mono font-bold text-orange-400">HL</span> {r.n_HL}</div>
        <div className="rounded bg-sky-400/20 p-1 text-center"><span className="font-mono font-bold text-sky-400">LH</span> {r.n_LH}</div>
        <div className="rounded bg-blue-500/20 p-1 text-center"><span className="font-mono font-bold text-blue-400">LL</span> {r.n_LL}</div>
      </div>
      <p className="text-[10px] text-[var(--shell-text-muted)]">{sig} significant · {r.n_ns} n.s. · FDR {r.fdr_cutoff.toFixed(5)}</p>
    </div>
  );
}
