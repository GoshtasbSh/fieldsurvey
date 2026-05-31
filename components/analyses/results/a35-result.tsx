// components/analyses/results/a35-result.tsx
"use client";
type F = { response_id: string; score: number; modal_value: number; n_answered: number };
type D = { flagged: F[]; n_flagged: number; n_total: number; pct_flagged: number; threshold: number; n_questions: number };
export function A35Result({ data }: { data: unknown }) {
  const r = data as D;
  if (r?.n_flagged === undefined) return null;
  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-[11.5px]">
        <span className="text-red-400 font-semibold">{r.n_flagged} flagged</span>
        <span className="text-[var(--shell-text-muted)]">of {r.n_total} ({(r.pct_flagged * 100).toFixed(1)}%)</span>
      </div>
      <p className="text-[10px] text-amber-400">⚠ Review manually — never auto-delete flagged responses.</p>
      <p className="text-[10px] text-[var(--shell-text-muted)]">{r.n_questions} questions used · threshold {(r.threshold * 100).toFixed(0)}%</p>
      {r.flagged.length > 0 && (
        <table className="w-full text-[10.5px] font-mono">
          <thead><tr className="text-[var(--shell-text-muted)]">
            <th className="text-left">Response ID</th><th className="text-right">Score</th><th className="text-right">Modal</th>
          </tr></thead>
          <tbody>{r.flagged.slice(0, 8).map((f, i) => (
            <tr key={i}>
              <td className="truncate max-w-[100px] text-[var(--shell-text-muted)]">{f.response_id.slice(0, 12)}&hellip;</td>
              <td className="text-right text-red-400">{(f.score * 100).toFixed(0)}%</td>
              <td className="text-right">{f.modal_value}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
