// components/analyses/results/s6-result.tsx
"use client";
type Zone = { zone_id: string; n_responses: number; category: string };
type S6Result = { zones: Zone[]; question_key: string; answer_option: string };
export function S6Result({ data }: { data: unknown }) {
  const r = data as S6Result;
  if (!r?.zones) return null;
  const counts: Record<string, number> = { HH: 0, HL: 0, LH: 0, LL: 0, suppressed: 0 };
  for (const z of r.zones) counts[z.category] = (counts[z.category] ?? 0) + 1;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-[var(--shell-text-muted)]">
        Question: <span className="font-mono">{r.question_key}</span> · Answer: <span className="font-mono">{r.answer_option || "—"}</span>
      </p>
      <div className="grid grid-cols-2 gap-1 text-[11px]">
        <div className="rounded bg-purple-600/30 p-1 text-center"><span className="font-bold text-purple-300">HH</span> {counts.HH} zones</div>
        <div className="rounded bg-orange-400/20 p-1 text-center"><span className="font-bold text-orange-300">HL</span> {counts.HL} zones</div>
        <div className="rounded bg-teal-400/20 p-1 text-center"><span className="font-bold text-teal-300">LH</span> {counts.LH} zones</div>
        <div className="rounded bg-zinc-500/20 p-1 text-center"><span className="font-bold text-zinc-300">LL</span> {counts.LL} zones</div>
      </div>
      <p className="text-[10px] text-[var(--shell-text-muted)]">{counts.suppressed} zones suppressed (n &lt; min)</p>
    </div>
  );
}
