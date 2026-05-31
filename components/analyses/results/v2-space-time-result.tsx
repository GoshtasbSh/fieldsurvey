// components/analyses/results/v2-space-time-result.tsx
"use client";

type CategoryCount = Record<string, number>;

type V2SpaceTimeData = {
  n: number;
  n_hot: number;
  n_cold: number;
  n_no_pattern: number;
  n_time_steps: number;
  time_range: string;
  time_bucket: string;
  category_counts: CategoryCount;
  category_colors: Record<string, string>;
  results: Array<{ id: string; category: string; mk_tau: number; mk_p: number; n_time_steps_valid: number }>;
  error?: string;
  message?: string;
};

const HOT_ORDER = [
  "New Hot Spot", "Consecutive Hot Spot", "Intensifying Hot Spot",
  "Persistent Hot Spot", "Diminishing Hot Spot", "Sporadic Hot Spot",
  "Oscillating Hot Spot", "Historical Hot Spot",
];
const COLD_ORDER = [
  "New Cold Spot", "Consecutive Cold Spot", "Intensifying Cold Spot",
  "Persistent Cold Spot", "Diminishing Cold Spot", "Sporadic Cold Spot",
  "Oscillating Cold Spot", "Historical Cold Spot",
];
const DEFAULT_COLORS: Record<string, string> = {
  "New Hot Spot": "#d73027", "Consecutive Hot Spot": "#f46d43",
  "Intensifying Hot Spot": "#fdae61", "Persistent Hot Spot": "#fee090",
  "Diminishing Hot Spot": "#ffeda0", "Sporadic Hot Spot": "#ffd700",
  "Oscillating Hot Spot": "#fd8d3c", "Historical Hot Spot": "#fecc5c",
  "New Cold Spot": "#4575b4", "Consecutive Cold Spot": "#74add1",
  "Intensifying Cold Spot": "#abd9e9", "Persistent Cold Spot": "#e0f3f8",
  "Diminishing Cold Spot": "#d0e4f0", "Sporadic Cold Spot": "#a6bddb",
  "Oscillating Cold Spot": "#2c7fb8", "Historical Cold Spot": "#a8ddb5",
  "No Pattern": "#888888",
};

function CategoryRow({ label, count, total, color }: {
  label: string; count: number; total: number; color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
      <span className="flex-1 text-[11px] truncate">{label}</span>
      <span className="font-mono text-[10px] text-[var(--shell-text-muted)] w-6 text-right">{count}</span>
      <div className="w-16 h-1.5 rounded bg-[var(--shell-border)] overflow-hidden">
        <div className="h-full rounded" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function V2SpaceTimeResult({ data }: { data: unknown }) {
  const d = data as V2SpaceTimeData;

  if (d.error) {
    return (
      <p className="text-[11.5px] text-amber-400">
        {d.message ?? d.error}
      </p>
    );
  }

  const colors = d.category_colors ?? DEFAULT_COLORS;
  const counts = d.category_counts ?? {};
  const total = d.n ?? 0;

  const hotEntries = HOT_ORDER.filter(c => (counts[c] ?? 0) > 0);
  const coldEntries = COLD_ORDER.filter(c => (counts[c] ?? 0) > 0);
  const npCount = counts["No Pattern"] ?? 0;

  return (
    <div className="space-y-3 text-[var(--shell-text)]">
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-1.5 text-center">
        {[
          { label: "Locations", value: total },
          { label: "Time steps", value: d.n_time_steps },
          { label: "Hot spots", value: d.n_hot },
        ].map(({ label, value }) => (
          <div key={label} className="rounded bg-[var(--shell-1)] border border-[var(--shell-border)] py-1.5 px-1">
            <div className="font-mono text-[13px] font-semibold">{value}</div>
            <div className="text-[9.5px] text-[var(--shell-text-muted)] mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {d.time_range && (
        <p className="text-[10px] text-[var(--shell-text-muted)] font-mono">
          Period: {d.time_range} &nbsp;·&nbsp; {d.time_bucket} buckets
        </p>
      )}

      {/* Hot spots */}
      {hotEntries.length > 0 && (
        <div className="space-y-1">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">Hot Spot Categories</p>
          {hotEntries.map(cat => (
            <CategoryRow key={cat} label={cat} count={counts[cat]} total={total} color={colors[cat] ?? "#fd8d3c"} />
          ))}
        </div>
      )}

      {/* Cold spots */}
      {coldEntries.length > 0 && (
        <div className="space-y-1">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">Cold Spot Categories</p>
          {coldEntries.map(cat => (
            <CategoryRow key={cat} label={cat} count={counts[cat]} total={total} color={colors[cat] ?? "#74add1"} />
          ))}
        </div>
      )}

      {npCount > 0 && (
        <div className="space-y-1">
          <CategoryRow label="No Pattern" count={npCount} total={total} color="#888888" />
        </div>
      )}

      <p className="text-[10px] text-[var(--shell-text-muted)] leading-snug">
        Categories follow ESRI Emerging Hot Spot Analysis convention. Mann-Kendall trend test
        (p &lt; 0.05) determines intensifying/diminishing classification.
      </p>
    </div>
  );
}
