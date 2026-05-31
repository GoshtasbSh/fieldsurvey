// components/analyses/results/a46-result.tsx
"use client";
type C = { question_key: string; test: string; p_raw: number; p_fdr: number; effect: number; significant: boolean };
type D = { comparisons: C[]; n_tests: number; n_significant: number; fdr_alpha: number; groups: string[] };
export function A46Result({ data }: { data: unknown }) {
  const r = data as D;
  if (!r?.comparisons) return null;
  const sig = r.comparisons.filter(c => c.significant);
  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-[11.5px]">
        <span className="font-semibold text-emerald-400">{r.n_significant} significant</span>
        <span className="text-[var(--shell-text-muted)]">of {r.n_tests} tested · FDR α={r.fdr_alpha}</span>
      </div>
      {sig.length > 0 ? (
        <table className="w-full text-[10.5px] font-mono">
          <thead><tr className="text-[var(--shell-text-muted)]">
            <th className="text-left">Question</th><th className="text-right">p_fdr</th><th className="text-right">test</th>
          </tr></thead>
          <tbody>{sig.slice(0, 8).map((c, i) => (
            <tr key={i}>
              <td className="truncate max-w-[130px]">{c.question_key}</td>
              <td className="text-right text-emerald-400">{c.p_fdr.toFixed(4)}</td>
              <td className="text-right text-[var(--shell-text-muted)]">{c.test === "mann_whitney" ? "MW" : "χ²"}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : (
        <p className="text-[11px] text-[var(--shell-text-muted)]">No significant differences after FDR correction.</p>
      )}
    </div>
  );
}
