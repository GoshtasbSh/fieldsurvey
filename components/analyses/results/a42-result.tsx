// components/analyses/results/a42-result.tsx
"use client";
type D = { gini: number; n_zones: number; lorenz_points: Array<{ x: number; y: number }>; total_universe: number; total_visits: number };
export function A42Result({ data }: { data: unknown }) {
  const r = data as D;
  if (r?.gini === undefined) return null;
  const color = r.gini < 0.2 ? "text-green-400" : r.gini < 0.4 ? "text-amber-400" : "text-red-400";
  const label = r.gini < 0.2 ? "equitable" : r.gini < 0.4 ? "moderate inequality" : "high inequality";
  return (
    <div className="space-y-2">
      <div className="flex gap-4 items-baseline">
        <div>
          <p className="text-[10px] text-[var(--shell-text-muted)]">Gini coefficient</p>
          <p className={`text-[22px] font-bold font-mono ${color}`}>{r.gini.toFixed(3)}</p>
        </div>
        <p className={`text-[12px] ${color}`}>{label}</p>
      </div>
      <p className="text-[10px] text-[var(--shell-text-muted)]">{r.n_zones} zones · {r.total_universe} universe · {r.total_visits} visits</p>
      <p className="text-[10px] text-[var(--shell-text-muted)]">0 = perfectly equal · 1 = all visits in one zone</p>
    </div>
  );
}
