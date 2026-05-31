// components/analyses/results/s4-result.tsx
"use client";
type Cluster = { rank: number; n_cases: number; n_total: number; relative_risk: number; llr: number; p_value: number };
type S4Result = { clusters: Cluster[]; n: number; c_total: number };
export function S4Result({ data }: { data: unknown }) {
  const r = data as S4Result;
  if (!r?.clusters) return null;
  if (r.clusters.length === 0) return <p className="text-[11.5px] text-[var(--shell-text-muted)]">No significant cluster found.</p>;
  const c = r.clusters[0];
  return (
    <div className="space-y-2">
      <p className="text-[11.5px] font-semibold">Primary cluster</p>
      <table className="w-full text-[11px] font-mono">
        <tbody>
          <tr><td className="text-[var(--shell-text-muted)]">Relative risk</td><td className="text-right">{c.relative_risk.toFixed(2)}×</td></tr>
          <tr><td className="text-[var(--shell-text-muted)]">LLR</td><td className="text-right">{c.llr.toFixed(3)}</td></tr>
          <tr><td className="text-[var(--shell-text-muted)]">p-value</td><td className="text-right">{c.p_value.toFixed(4)}</td></tr>
          <tr><td className="text-[var(--shell-text-muted)]">Cases / Total</td><td className="text-right">{c.n_cases} / {c.n_total}</td></tr>
        </tbody>
      </table>
      <p className="text-[10px] text-[var(--shell-text-muted)]">n = {r.n} · {r.c_total} total cases</p>
    </div>
  );
}
