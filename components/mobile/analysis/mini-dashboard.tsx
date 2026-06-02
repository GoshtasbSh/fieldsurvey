import type { DailyBucket, CoverageMetrics } from "@/lib/queries/analytics";

type Props = {
  totalPoints: number;
  todayDelta: number;
  coverage: CoverageMetrics;
  daily: DailyBucket[];
};

/**
 * Admin Analysis mini dashboard — 3 KPI cards + 1 sparkline (14-day daily
 * activity). Pure server-rendered SVG; no client interactivity needed.
 */
export function MiniDashboard({ totalPoints, todayDelta, coverage, daily }: Props) {
  const max = Math.max(1, ...daily.map((d) => d.total));
  const W = 320;
  const H = 80;
  const stepX = daily.length > 1 ? W / (daily.length - 1) : 0;
  const points = daily
    .map((d, i) => `${i * stepX},${H - (d.total / max) * (H - 8) - 2}`)
    .join(" ");
  const area = `${points} ${W},${H} 0,${H}`;
  const last = daily.length > 0 ? daily[daily.length - 1].total : 0;
  const prev = daily.length > 1 ? daily[daily.length - 2].total : last;
  const trendUp = last > prev;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--m-bg)",
        overflowY: "auto",
        padding: "20px 14px 32px",
      }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Analysis</h1>
      <p
        style={{
          fontSize: 12.5,
          color: "var(--m-ink-2)",
          marginBottom: 18,
          lineHeight: 1.4,
        }}
      >
        Mini dashboard. Full charts are on the desktop /analyze view.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <Kpi label="Total points" value={totalPoints.toLocaleString()} />
        <Kpi label="Today" value={`+${todayDelta}`} positive />
        <Kpi
          label="Match rate"
          value={`${Math.round(coverage.match_rate_pct)}%`}
        />
        <Kpi
          label="Median accuracy"
          value={coverage.median_accuracy_m === null ? "—" : `${coverage.median_accuracy_m.toFixed(1)} m`}
        />
      </div>

      <div
        style={{
          background: "var(--m-card)",
          border: "1px solid var(--m-line)",
          borderRadius: 14,
          padding: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--m-ink-2)",
            }}
          >
            Daily activity · 14d
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: trendUp ? "var(--m-success)" : "var(--m-warn)",
            }}
          >
            {trendUp ? "▲" : "▼"} {last} today
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={120}>
          <polygon points={area} fill="var(--m-accent-dim)" />
          <polyline
            points={points}
            fill="none"
            stroke="var(--m-accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {daily.length > 0 ? (
            <circle
              cx={(daily.length - 1) * stepX}
              cy={H - (last / max) * (H - 8) - 2}
              r="3"
              fill="var(--m-accent)"
            />
          ) : null}
        </svg>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--m-card)",
        border: "1px solid var(--m-line)",
        borderRadius: 14,
        padding: "14px 14px 16px",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 800,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--m-ink-2)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: "-0.01em",
          color: positive ? "var(--m-success)" : "var(--m-ink)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
