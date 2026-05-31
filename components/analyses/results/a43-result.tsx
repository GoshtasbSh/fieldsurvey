// components/analyses/results/a43-result.tsx
"use client";
type G = { group: string; n: number; weight: number };
type D = { cv: number; effective_n: number; deff: number; max_weight: number; min_weight: number; n_trimmed: number; group_summary: G[]; n: number; n_groups: number };
export function A43Result({ data }: { data: unknown }) {
  const r = data as D;
  if (r?.cv === undefined) return null;
  return (
    <div className="space-y-2">
      <table className="w-full text-[11px] font-mono">
        <tbody>
          <tr><td className="text-[var(--shell-text-muted)]">CV</td><td className="text-right font-bold">{r.cv.toFixed(3)}</td></tr>
          <tr><td className="text-[var(--shell-text-muted)]">Effective n</td><td className="text-right">{r.effective_n.toFixed(0)} <span className="text-[9px] text-[var(--shell-text-muted)]">of {r.n}</span></td></tr>
          <tr><td className="text-[var(--shell-text-muted)]">DEFF</td><td className="text-right">{r.deff.toFixed(3)}</td></tr>
          <tr><td className="text-[var(--shell-text-muted)]">Weight range</td><td className="text-right">{r.min_weight.toFixed(2)}× – {r.max_weight.toFixed(2)}×</td></tr>
          {r.n_trimmed > 0 && <tr><td className="text-amber-400">Trimmed</td><td className="text-right text-amber-400">{r.n_trimmed}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
