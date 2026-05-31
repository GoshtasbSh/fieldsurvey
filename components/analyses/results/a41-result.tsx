// components/analyses/results/a41-result.tsx
"use client";
type Zone = { zone_id: string; n_universe: number; n_responses: number; expected_pct: number; actual_pct: number; deficit: number };
type D = { zones: Zone[]; n_zones: number; total_universe: number; total_responses: number };
export function A41Result({ data }: { data: unknown }) {
  const r = data as D;
  if (!r?.zones) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-[var(--shell-text-muted)]">{r.n_zones} zones · universe {r.total_universe} · responses {r.total_responses}</p>
      <table className="w-full text-[10.5px] font-mono">
        <thead><tr className="text-[var(--shell-text-muted)]">
          <th className="text-left">Zone</th><th className="text-right">Exp%</th><th className="text-right">Act%</th><th className="text-right">Deficit</th>
        </tr></thead>
        <tbody>{r.zones.slice(0, 8).map((z, i) => (
          <tr key={i}>
            <td className="text-[var(--shell-text-muted)]">{z.zone_id}</td>
            <td className="text-right">{(z.expected_pct * 100).toFixed(1)}</td>
            <td className="text-right">{(z.actual_pct * 100).toFixed(1)}</td>
            <td className={`text-right font-bold ${z.deficit > 0.02 ? "text-red-400" : z.deficit < -0.02 ? "text-green-400" : ""}`}>
              {z.deficit > 0 ? "+" : ""}{(z.deficit * 100).toFixed(1)}pp
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
