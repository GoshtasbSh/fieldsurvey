// components/analyses/results/a7-result.tsx
"use client";
type G = { group: string; n: number; raw_mean: number; weight: number };
type D = { raw_mean: number; weighted_mean: number; delta: number; group_stats: G[]; n: number };
export function A7Result({ data }: { data: unknown }) {
  const r = data as D;
  if (r?.raw_mean === undefined) return null;
  const bigDelta = Math.abs(r.delta) > 0.1;
  return (
    <div className="space-y-2">
      <div className="flex gap-4 text-[12px]">
        <div>
          <p className="text-[10px] text-[var(--shell-text-muted)]">Raw mean</p>
          <p className="font-mono font-bold">{r.raw_mean.toFixed(3)}</p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--shell-text-muted)]">Weighted mean</p>
          <p className="font-mono font-bold text-amber-400">{r.weighted_mean.toFixed(3)}</p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--shell-text-muted)]">Δ</p>
          <p className={`font-mono font-bold ${bigDelta ? "text-orange-400" : "text-[var(--shell-text-muted)]"}`}>
            {r.delta > 0 ? "+" : ""}{r.delta.toFixed(3)}
          </p>
        </div>
      </div>
      <table className="w-full text-[10.5px] font-mono">
        <thead><tr className="text-[var(--shell-text-muted)]">
          <th className="text-left">Group</th><th className="text-right">n</th><th className="text-right">mean</th><th className="text-right">weight</th>
        </tr></thead>
        <tbody>{(r.group_stats ?? []).map((g, i) => (
          <tr key={i}>
            <td className="truncate max-w-[80px]">{g.group}</td>
            <td className="text-right">{g.n}</td>
            <td className="text-right">{g.raw_mean.toFixed(3)}</td>
            <td className="text-right">{g.weight.toFixed(2)}×</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
