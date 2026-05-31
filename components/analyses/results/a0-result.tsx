// components/analyses/results/a0-result.tsx
"use client";
type A0Result = {
  spec: { classCount: number; inferredType: string };
  profile: { key: string; distinct: number };
  breaks: number[];
  legendColors: string[];
  n_responses: number;
};
export function A0Result({ data }: { data: unknown }) {
  const r = data as A0Result;
  if (!r?.legendColors) return null;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-[var(--shell-text-muted)]">
        {r.n_responses} responses · {r.profile.distinct} distinct values
      </p>
      <div className="flex gap-1 flex-wrap">
        {r.legendColors.map((c, i) => (
          <div key={i} className="flex flex-col items-center gap-0.5">
            <div className="w-5 h-5 rounded-sm border border-white/20" style={{ background: c }} />
            {r.breaks[i] !== undefined && (
              <span className="text-[9px] text-[var(--shell-text-muted)] font-mono">{r.breaks[i].toFixed(1)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
