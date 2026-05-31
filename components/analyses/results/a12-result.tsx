// components/analyses/results/a12-result.tsx
"use client";
type Zone = { zone_id: string; count: number; lat: number; lon: number };
type D = { zones: Zone[]; n: number; n_zones: number; zone_unit: string };
export function A12Result({ data }: { data: unknown }) {
  const r = data as D;
  if (!r?.zones) return null;
  const maxCount = Math.max(...r.zones.map(z => z.count), 1);
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-[var(--shell-text-muted)]">{r.n_zones} zones · {r.n} total points · {r.zone_unit}</p>
      <div className="space-y-1">
        {r.zones.slice(0, 8).map((z, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-[var(--shell-text-muted)] w-16 truncate flex-shrink-0">{z.zone_id}</span>
            <div className="flex-1 h-2 bg-[var(--shell-2)] rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(z.count / maxCount) * 100}%` }} />
            </div>
            <span className="text-[10px] font-mono font-bold text-right w-8 flex-shrink-0">{z.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
