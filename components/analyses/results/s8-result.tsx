// components/analyses/results/s8-result.tsx
"use client";
type S8Result = { lee_L: number; pearson_r: number; disagreement: boolean; n_HH: number; n_LL: number; n_HL: number; n_LH: number; n_ns: number; n: number };
export function S8Result({ data }: { data: unknown }) {
  const r = data as S8Result;
  if (r?.lee_L === undefined) return null;
  return (
    <div className="space-y-2">
      <table className="w-full text-[11px] font-mono">
        <tbody>
          <tr><td className="text-[var(--shell-text-muted)]">Lee&apos;s L</td><td className="text-right font-bold">{r.lee_L.toFixed(4)}</td></tr>
          <tr><td className="text-[var(--shell-text-muted)]">Pearson r</td><td className="text-right">{r.pearson_r.toFixed(4)}</td></tr>
        </tbody>
      </table>
      {r.disagreement && (
        <p className="text-[11px] text-amber-400">&#x26A0; L and r disagree — questions are correlated but not spatially co-located.</p>
      )}
      <div className="flex gap-3 text-[10.5px] text-[var(--shell-text-muted)]">
        <span>HH {r.n_HH}</span><span>LL {r.n_LL}</span><span>HL {r.n_HL}</span><span>LH {r.n_LH}</span><span>ns {r.n_ns}</span>
      </div>
    </div>
  );
}
