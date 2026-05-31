// components/analyses/results/a3-result.tsx
"use client";
type SetItem = { name: string; size: number };
type Intersection = { sets: string[]; count: number };
type D = { sets: SetItem[]; intersections: Intersection[]; n: number; question_key: string };
export function A3Result({ data }: { data: unknown }) {
  const r = data as D;
  if (!r?.sets) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-[var(--shell-text-muted)]">n = {r.n} · {r.sets.length} options</p>
      <div className="space-y-1">
        <p className="text-[10px] font-mono text-[var(--shell-text-muted)] uppercase tracking-wide">Top options</p>
        {r.sets.slice(0, 6).map((s, i) => (
          <div key={i} className="flex justify-between text-[11px]">
            <span className="font-mono text-[var(--shell-text)] truncate max-w-[140px]">{s.name}</span>
            <span className="text-[var(--shell-text-muted)]">{s.size}</span>
          </div>
        ))}
      </div>
      {r.intersections.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-[var(--shell-border)]">
          <p className="text-[10px] font-mono text-[var(--shell-text-muted)] uppercase tracking-wide">Top co-occurrences</p>
          {r.intersections.slice(0, 5).map((x, i) => (
            <div key={i} className="flex justify-between text-[11px]">
              <span className="font-mono text-[var(--shell-text)] truncate max-w-[140px]">{x.sets.join(" + ")}</span>
              <span className="text-[var(--shell-text-muted)]">{x.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
