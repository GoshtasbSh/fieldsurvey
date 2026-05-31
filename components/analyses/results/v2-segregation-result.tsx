// components/analyses/results/v2-segregation-result.tsx
"use client";

type ZoneDetail = {
  zone_id: string;
  lat: number;
  lon: number;
  n: number;
  composition: Record<string, number>;
  majority_pct: number;
  entropy: number;
};

type V2SegregationData = {
  dissimilarity_D: number;
  isolation_xPx: number;
  interaction_xPy: number;
  entropy_H: number;
  gini: number;
  n_zones: number;
  n_groups: number;
  group_labels: string[];
  majority_group: string;
  minority_group: string;
  group_totals: Record<string, number>;
  group_props: Record<string, number>;
  overall_entropy: number;
  zone_details: ZoneDetail[];
  interpretation: { D: string; isolation: string; entropy_normalised: number; summary: string };
  n: number;
  error?: string;
  message?: string;
};

function IndexBar({ label, value, maxVal = 1, color, tooltip }: {
  label: string; value: number; maxVal?: number; color: string; tooltip: string;
}) {
  const pct = Math.min((value / maxVal) * 100, 100);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between items-center">
        <span title={tooltip} className="text-[11px] cursor-help">{label}</span>
        <span className="font-mono text-[11px] font-semibold">{value.toFixed(3)}</span>
      </div>
      <div className="h-1.5 rounded bg-[var(--shell-border)] overflow-hidden">
        <div className="h-full rounded transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function V2SegregationResult({ data }: { data: unknown }) {
  const d = data as V2SegregationData;

  if (d.error) {
    return <p className="text-[11.5px] text-amber-400">{d.message ?? d.error}</p>;
  }

  const topZones = (d.zone_details ?? []).slice(0, 5);
  const { D, isolation, summary } = d.interpretation ?? {};

  const dLevel = d.dissimilarity_D < 0.3 ? "low" : d.dissimilarity_D < 0.6 ? "moderate" : "high";
  const dColor = d.dissimilarity_D < 0.3 ? "#22c55e" : d.dissimilarity_D < 0.6 ? "#f59e0b" : "#ef4444";

  return (
    <div className="space-y-3 text-[var(--shell-text)]">
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-1.5 text-center">
        {[
          { label: "Responses", value: d.n },
          { label: "Zones", value: d.n_zones },
          { label: "Groups", value: d.n_groups },
        ].map(({ label, value }) => (
          <div key={label} className="rounded bg-[var(--shell-1)] border border-[var(--shell-border)] py-1.5 px-1">
            <div className="font-mono text-[13px] font-semibold">{value}</div>
            <div className="text-[9.5px] text-[var(--shell-text-muted)] mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Groups */}
      <div className="space-y-0.5">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">Group distribution</p>
        {(d.group_labels ?? []).map(g => {
          const pct = (d.group_props?.[g] ?? 0) * 100;
          return (
            <div key={g} className="flex items-center gap-2 text-[10.5px]">
              <span className="w-24 truncate">{g}</span>
              <div className="flex-1 h-1.5 rounded bg-[var(--shell-border)] overflow-hidden">
                <div className="h-full rounded bg-[var(--accent-1,#0EA5E9)]" style={{ width: `${pct}%` }} />
              </div>
              <span className="font-mono text-[var(--shell-text-muted)] w-8 text-right">{pct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>

      {/* Five indices */}
      <div className="space-y-2">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">Segregation Indices</p>
        <IndexBar
          label="Dissimilarity (D)"
          value={d.dissimilarity_D}
          color={dColor}
          tooltip="0=fully integrated, 1=fully segregated. Binary: majority vs minority group."
        />
        <IndexBar
          label="Isolation (P*aa)"
          value={d.isolation_xPx}
          color="#f97316"
          tooltip="Probability a majority-group member's zone-mate is also majority. Expected = majority proportion."
        />
        <IndexBar
          label="Interaction (P*ab)"
          value={d.interaction_xPy}
          color="#3b82f6"
          tooltip="Probability a majority member encounters a minority member."
        />
        <IndexBar
          label="Entropy (H)"
          value={d.entropy_H}
          color="#a855f7"
          tooltip="Area-weighted entropy divergence: 0=perfectly clustered, 1=uniform distribution."
        />
        <IndexBar
          label="Gini"
          value={d.gini}
          color="#ec4899"
          tooltip="Gini coefficient of zone-level majority share inequality."
        />
      </div>

      {/* D classification badge */}
      <div className={`rounded p-2 text-[10.5px] ${dLevel === "low" ? "bg-emerald-500/10 text-emerald-300" : dLevel === "moderate" ? "bg-amber-500/10 text-amber-300" : "bg-red-500/10 text-red-300"}`}>
        Dissimilarity level: <strong>{dLevel}</strong> — {D ?? ""}
      </div>

      {/* Top zones */}
      {topZones.length > 0 && (
        <div className="space-y-1">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">Top zones by count</p>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[var(--shell-text-muted)]">
                <td className="pb-1">Zone</td>
                <td className="pb-1 text-right">n</td>
                <td className="pb-1 text-right">Majority %</td>
                <td className="pb-1 text-right">Entropy</td>
              </tr>
            </thead>
            <tbody>
              {topZones.map(z => (
                <tr key={z.zone_id} className="border-t border-[var(--shell-border)]">
                  <td className="py-0.5 font-mono">{z.zone_id}</td>
                  <td className="py-0.5 text-right font-mono">{z.n}</td>
                  <td className="py-0.5 text-right font-mono">{(z.majority_pct * 100).toFixed(0)}%</td>
                  <td className="py-0.5 text-right font-mono">{z.entropy.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-[var(--shell-text-muted)] leading-snug border-t border-[var(--shell-border)] pt-2">
        Indices from Massey & Denton (1988). Results are sensitive to zone size (MAUP) — try different cell sizes.
      </p>
    </div>
  );
}
