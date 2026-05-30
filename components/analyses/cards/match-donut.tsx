"use client";
import type { MatchStatusCounts } from "@/lib/match/status";

type Props = { projectId?: string; counts?: MatchStatusCounts };

export function MatchDonut({ counts }: Props) {
  if (!counts) return null;
  const total = counts.total_with_status + counts.r1_count;
  return (
    <div className="bento-panel p-4">
      <div className="bento-label mb-3">Response match composition</div>
      <div className="flex items-center gap-4">
        <DonutSvg total={total} counts={counts} />
        <div className="flex flex-col gap-1.5 min-w-0">
          <Row color="#ffffff" label="M1 Matched" n={counts.m1_count} total={total} />
          <Row color="#fde047" label="F1 Field only" n={counts.f1_count} total={total} />
          <Row color="#a855f7" label="R1 Resp only" n={counts.r1_count} total={total} />
        </div>
      </div>
    </div>
  );
}

function DonutSvg({ total, counts }: { total: number; counts: MatchStatusCounts }) {
  if (total === 0) return <div className="h-14 w-14 rounded-full border border-[var(--shell-border)]" />;
  const r = 14;
  const c = 2 * Math.PI * r;
  const m = counts.m1_count / total;
  const f = counts.f1_count / total;
  return (
    <svg viewBox="0 0 36 36" className="h-14 w-14">
      <circle cx="18" cy="18" r={r} fill="none" stroke="#a855f7" strokeWidth="6" />
      <circle cx="18" cy="18" r={r} fill="none" stroke="#fde047" strokeWidth="6" strokeDasharray={`${(m + f) * c} ${c}`} transform="rotate(-90 18 18)" />
      <circle cx="18" cy="18" r={r} fill="none" stroke="#ffffff" strokeWidth="6" strokeDasharray={`${m * c} ${c}`} transform="rotate(-90 18 18)" />
    </svg>
  );
}

function Row({ color, label, n, total }: { color: string; label: string; n: number; total: number }) {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      <span className="text-[11.5px] font-semibold text-[var(--shell-text-2)] flex-1">{label}</span>
      <span className="font-mono text-[10.5px] tabular-nums">{n} ({pct}%)</span>
    </div>
  );
}
