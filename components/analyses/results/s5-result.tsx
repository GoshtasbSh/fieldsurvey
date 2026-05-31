// components/analyses/results/s5-result.tsx
"use client";
type Bin = { lo_km: number; hi_km: number | null; n: number; mean: number; se: number };
type S5Result = { bins: Bin[]; trend: string; n: number };
const TREND_LABEL: Record<string, string> = {
  decaying: "Decaying with distance", increasing: "Increasing with distance", flat: "No clear trend",
};
export function S5Result({ data }: { data: unknown }) {
  const r = data as S5Result;
  if (!r?.bins) return null;
  return (
    <div className="space-y-2">
      <p className="text-[12px] font-semibold">{TREND_LABEL[r.trend] ?? r.trend}</p>
      <table className="w-full text-[10.5px] font-mono">
        <thead><tr className="text-[var(--shell-text-muted)]">
          <th className="text-left">km</th><th className="text-right">n</th><th className="text-right">mean</th><th className="text-right">±SE</th>
        </tr></thead>
        <tbody>
          {r.bins.filter((b) => b.n > 0).map((b, i) => (
            <tr key={i}>
              <td>{b.lo_km}–{b.hi_km ?? "∞"}</td>
              <td className="text-right">{b.n}</td>
              <td className="text-right">{b.mean.toFixed(3)}</td>
              <td className="text-right">{b.se.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
