// components/analyses/results/s1-result.tsx
"use client";
type S1Result = { moran_I: number; moran_p: number; geary_C: number; geary_p: number; verdict: string; n: number };
const VERDICT_COLOR: Record<string, string> = {
  clustered: "text-orange-400", dispersed: "text-blue-400",
  random: "text-[var(--shell-text-muted)]", non_stationary: "text-purple-400",
};
const VERDICT_LABEL: Record<string, string> = {
  clustered: "Spatially Clustered", dispersed: "Spatially Dispersed",
  random: "Random (not significant)", non_stationary: "Non-Stationary (Moran/Geary disagree)",
};
export function S1Result({ data }: { data: unknown }) {
  const r = data as S1Result;
  if (!r?.verdict) return null;
  return (
    <div className="space-y-2">
      <p className={`text-[13px] font-semibold ${VERDICT_COLOR[r.verdict] ?? ""}`}>
        {VERDICT_LABEL[r.verdict] ?? r.verdict}
      </p>
      <table className="w-full text-[11px] font-mono">
        <thead><tr className="text-[var(--shell-text-muted)]">
          <th className="text-left py-0.5">Stat</th><th className="text-right">Value</th><th className="text-right">p (sim)</th>
        </tr></thead>
        <tbody>
          <tr><td>Moran&apos;s I</td><td className="text-right">{r.moran_I.toFixed(4)}</td><td className="text-right">{r.moran_p.toFixed(4)}</td></tr>
          <tr><td>Geary&apos;s C</td><td className="text-right">{r.geary_C.toFixed(4)}</td><td className="text-right">{r.geary_p.toFixed(4)}</td></tr>
        </tbody>
      </table>
      <p className="text-[10px] text-[var(--shell-text-muted)]">n = {r.n}</p>
    </div>
  );
}
