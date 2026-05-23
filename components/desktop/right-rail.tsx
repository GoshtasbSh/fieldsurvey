"use client";

import { useState, type ReactNode } from "react";
import { Activity, BarChart3, Users, MousePointer2, ChevronRight, TrendingUp, Clock } from "lucide-react";
import type { MatchStatusCounts } from "@/lib/match/status";
import { ChatPanel } from "@/components/chat/chat-panel";
import type { ChatMessage } from "@/lib/queries/chat";
import type { StatusRow } from "./left-rail";
import type { HourBucket, DowBucket } from "@/lib/queries/analytics";

export type RightRailTab = "pulse" | "analyze" | "team" | "inspect";
export type SurveyorBrief = { collector_id: string | null; name: string; count: number };
export type DailyBucket = { day: string; total: number };
export type CoverageMetrics = { match_rate_pct: number; median_accuracy_m: number | null; photo_coverage_pct: number; density_per_km2: number | null };
export type ChatMember = { user_id: string; display_name: string; email: string; avatar_url: string | null };

type Props = {
  projectId: string;
  currentUserId: string | null;
  matchCounts: MatchStatusCounts;
  statuses: StatusRow[];
  pointsTotal: number;
  todayDelta: number;
  unreadChats?: number;
  daily?: DailyBucket[];
  hourly?: HourBucket[];
  dow?: DowBucket[];
  surveyors?: SurveyorBrief[];
  coverage?: CoverageMetrics;
  chatMembers?: ChatMember[];
  initialChat?: ChatMessage[];
  onCollapse: () => void;
};

export function DesktopRightRail({
  projectId, currentUserId, matchCounts, statuses, pointsTotal, todayDelta,
  unreadChats, daily = [], hourly = [], dow = [], surveyors = [], coverage,
  chatMembers = [], initialChat = [], onCollapse,
}: Props) {
  const [tab, setTab] = useState<RightRailTab>("pulse");

  return (
    <aside className="flex h-full w-[360px] flex-col overflow-hidden border-l border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)]">
      {/* Tab bar */}
      <nav className="flex items-center gap-1 border-b border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)] px-2 py-2">
        <div className="grid flex-1 grid-cols-4 gap-1">
          {([
            { key: "pulse", label: "Pulse", Icon: Activity, badge: undefined as number | undefined },
            { key: "analyze", label: "Analyze", Icon: BarChart3, badge: undefined as number | undefined },
            { key: "team", label: "Team", Icon: Users, badge: unreadChats },
            { key: "inspect", label: "Inspect", Icon: MousePointer2, badge: undefined as number | undefined },
          ] as const).map(({ key, label, Icon, badge }) => {
            const on = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`relative flex flex-col items-center gap-1 rounded-[10px] px-0 py-2 transition ${
                  on ? "bg-[oklch(78%_0.155_234/0.12)] text-[oklch(78%_0.155_234)]" : "text-[oklch(58%_0.014_250)] hover:bg-[oklch(20%_0.016_250)] hover:text-[oklch(76%_0.012_250)]"
                }`}
              >
                <Icon className="h-[17px] w-[17px]" strokeWidth={1.7} />
                <span className="font-display text-[10.5px] font-bold">{label}</span>
                {typeof badge === "number" && badge > 0 && (
                  <span className="absolute right-[18%] top-[5px] inline-flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-[oklch(17%_0.014_250)] bg-[oklch(68%_0.21_25)] px-1 font-mono text-[9.5px] font-bold text-white">{badge}</span>
                )}
                {on && <span className="absolute -bottom-2.5 left-[30%] right-[30%] h-0.5 rounded-t bg-[oklch(78%_0.155_234)] shadow-[0_0_8px_oklch(78%_0.155_234/0.35)]" />}
              </button>
            );
          })}
        </div>
        {/* Collapse button */}
        <button
          onClick={onCollapse}
          className="ml-1 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[oklch(28%_0.02_250/0.55)] text-[oklch(58%_0.014_250)] transition hover:bg-[oklch(20%_0.016_250)] hover:text-[oklch(96%_0.008_250)]"
          aria-label="Collapse panel"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </nav>

      {/* Tab content */}
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "pulse" && (
          <Scroll>
            <PulseTab
              matchCounts={matchCounts}
              statuses={statuses}
              pointsTotal={pointsTotal}
              todayDelta={todayDelta}
              daily={daily}
            />
          </Scroll>
        )}
        {tab === "analyze" && (
          <Scroll>
            <AnalyzeTab
              matchCounts={matchCounts}
              hourly={hourly}
              dow={dow}
              surveyors={surveyors}
              coverage={coverage}
            />
          </Scroll>
        )}
        {tab === "team" && (
          currentUserId
            ? <ChatPanel projectId={projectId} currentUserId={currentUserId} members={chatMembers} initial={initialChat} />
            : <Placeholder label="Sign in to chat" />
        )}
        {tab === "inspect" && <Placeholder label="Click a pin on the map to inspect it" />}
      </div>
    </aside>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PULSE TAB — operational, real-time snapshot of field activity
// ──────────────────────────────────────────────────────────────────────────────

function PulseTab({
  matchCounts, statuses, pointsTotal, todayDelta, daily,
}: {
  matchCounts: MatchStatusCounts;
  statuses: StatusRow[];
  pointsTotal: number;
  todayDelta: number;
  daily: DailyBucket[];
}) {
  const attentionTotal = matchCounts.f1_count + matchCounts.r1_count;
  return (
    <>
      {/* Needs attention */}
      {attentionTotal > 0 && (
        <Card framed tone="warn" title={
          <span className="flex items-center gap-2.5">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[oklch(86%_0.18_88/0.4)] bg-[oklch(86%_0.18_88/0.18)] text-[oklch(82%_0.17_86)]">
              <Activity className="h-3.5 w-3.5" strokeWidth={1.7} />
            </span>
            <span>
              <span className="block font-display text-[13px] font-extrabold">Needs attention</span>
              <span className="block text-[10.5px] text-[oklch(58%_0.014_250)]">{attentionTotal} points have incomplete data</span>
            </span>
          </span>
        }>
          <div className="grid grid-cols-2 gap-2.5">
            <AttentionTile
              tone="warn"
              pinClass="bg-[oklch(78%_0.165_70)] ring-2 ring-[#fde047]"
              label="F1 · Field only"
              count={matchCounts.f1_count}
              desc="Collected but no matching response"
              cta="Chase responses →"
            />
            <AttentionTile
              tone="violet"
              pinClass="bg-[oklch(72%_0.18_305)] rounded-[3px] ring-2 ring-[#a855f7]"
              label="R1 · Response only"
              count={matchCounts.r1_count}
              desc="Response in, no field visit yet"
              cta="Assign surveyor →"
            />
          </div>
        </Card>
      )}

      {/* Points counter + today delta */}
      <div className="rounded-[14px] border border-[oklch(78%_0.155_234/0.18)] bg-[radial-gradient(circle_at_top_right,oklch(20%_0.06_234/0.6),transparent_65%),linear-gradient(180deg,oklch(20%_0.025_250)_0%,oklch(17%_0.018_250)_100%)] p-4 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[oklch(78%_0.155_234)] to-transparent opacity-50" />
        <div className="grid grid-cols-[1fr_auto] items-end gap-3.5">
          <div>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[oklch(58%_0.014_250)]">Points collected</div>
            <div className="font-display text-[40px] font-extrabold leading-none tracking-[-0.025em] tabular-nums">{pointsTotal}</div>
          </div>
          {todayDelta > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[oklch(76%_0.16_158/0.3)] bg-[oklch(76%_0.16_158/0.14)] px-2.5 py-1 font-mono text-[11px] font-bold text-[oklch(76%_0.16_158)]">
              ▲ +{todayDelta} today
            </span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-[oklch(50%_0.025_250/0.18)] pt-3">
          <KpiTile v={`${Math.round((matchCounts.m1_count / Math.max(pointsTotal, 1)) * 100)}%`} l="Match rate" />
          <KpiTile v={String(matchCounts.m1_count)} l="M1 matched" tone="accent" />
          <KpiTile v={String(matchCounts.r1_count)} l="R1 awaiting" tone="violet" />
        </div>
      </div>

      {/* Live activity — last 14 days */}
      <Card
        title={
          <span className="flex items-center gap-2">
            <TrendingUp className="h-3 w-3" strokeWidth={1.7} />
            Live activity · 14 days
          </span>
        }
      >
        <ActivitySparkline buckets={daily} showToday />
      </Card>

      {/* Status snapshot */}
      <Card title="Status snapshot">
        <div className="space-y-2">
          {statuses.map((s) => (
            <div key={s.id} className="grid grid-cols-[8px_1fr_auto] items-center gap-2.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <div>
                <span className="text-[11.5px] font-semibold text-[oklch(76%_0.012_250)]">{s.label}</span>
                <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[oklch(24%_0.018_250)]">
                  <div className="h-full rounded-full" style={{ width: `${Math.round(s.pct * 100)}%`, background: s.color }} />
                </div>
              </div>
              <div className="text-right">
                <span className="font-mono text-[11.5px] font-semibold tabular-nums text-[oklch(96%_0.008_250)]">{s.count}</span>
                <span className="block font-mono text-[9px] text-[oklch(58%_0.014_250)]">{Math.round(s.pct * 100)}%</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// ANALYZE TAB — spatial survey analytics: patterns, trends, quality
// ──────────────────────────────────────────────────────────────────────────────

function AnalyzeTab({
  matchCounts, hourly, dow, surveyors, coverage,
}: {
  matchCounts: MatchStatusCounts;
  hourly: HourBucket[];
  dow: DowBucket[];
  surveyors: SurveyorBrief[];
  coverage?: CoverageMetrics;
}) {
  const total = matchCounts.total_with_status + matchCounts.r1_count;
  return (
    <>
      {/* Match status composition */}
      <Card title="Response match composition">
        <div className="flex items-center gap-4">
          <DonutBreakdown total={total} matchCounts={matchCounts} />
          <div className="flex flex-col gap-1.5 min-w-0">
            <MatchLegendRow color="#ffffff" label="M1 Matched" n={matchCounts.m1_count} total={total} />
            <MatchLegendRow color="#fde047" label="F1 Field only" n={matchCounts.f1_count} total={total} />
            <MatchLegendRow color="#a855f7" label="R1 Resp only" n={matchCounts.r1_count} total={total} />
          </div>
        </div>
      </Card>

      {/* Time of day distribution */}
      <Card
        title={
          <span className="flex items-center gap-2">
            <Clock className="h-3 w-3" strokeWidth={1.7} />
            Time of day collected (UTC)
          </span>
        }
      >
        <HourChart buckets={hourly} />
      </Card>

      {/* Day of week distribution */}
      <Card title="Day of week pattern">
        <DowChart buckets={dow} />
      </Card>

      {/* Surveyor productivity */}
      <Card title="Surveyor productivity">
        {surveyors.length === 0 ? (
          <p className="text-[11px] text-[oklch(58%_0.014_250)]">No collectors yet.</p>
        ) : (
          <div className="space-y-2">
            {surveyors.slice(0, 8).map((s, i) => {
              const max = surveyors[0]?.count || 1;
              const pct = Math.round((s.count / max) * 100);
              return (
                <div key={s.collector_id ?? `u_${i}`} className="grid grid-cols-[20px_1fr_auto] items-center gap-2">
                  <span className="font-mono text-[11px] font-bold text-[oklch(58%_0.014_250)] tabular-nums">{i + 1}</span>
                  <div>
                    <div className="text-[12px] font-semibold text-[oklch(96%_0.008_250)]">{s.name}</div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-[oklch(24%_0.018_250)]">
                      <div className="h-full rounded-full bg-[oklch(78%_0.155_234)]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="font-mono text-[12px] font-bold tabular-nums">{s.count}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Data quality */}
      {coverage && (
        <Card title="Data quality metrics">
          <div className="grid grid-cols-2 gap-2">
            <CovTile label="Match rate" value={`${coverage.match_rate_pct}%`} tone={coverage.match_rate_pct >= 70 ? "good" : coverage.match_rate_pct >= 40 ? "warn" : "bad"} />
            <CovTile label="GPS accuracy" value={coverage.median_accuracy_m != null ? `${coverage.median_accuracy_m.toFixed(0)} m` : "—"} />
            <CovTile label="Photo coverage" value={`${coverage.photo_coverage_pct}%`} tone={coverage.photo_coverage_pct >= 70 ? "good" : "warn"} />
            <CovTile label="Density" value={coverage.density_per_km2 != null ? `${coverage.density_per_km2}/km²` : "—"} />
          </div>
          <div className="mt-3 rounded-lg bg-[oklch(20%_0.016_250)] px-3 py-2">
            <div className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-[oklch(58%_0.014_250)]">Match rate progress</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 overflow-hidden rounded-full bg-[oklch(24%_0.018_250)]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${coverage.match_rate_pct}%`,
                    background: coverage.match_rate_pct >= 70
                      ? "oklch(76% 0.16 158)"
                      : coverage.match_rate_pct >= 40
                      ? "oklch(78% 0.165 70)"
                      : "oklch(68% 0.21 25)",
                  }}
                />
              </div>
              <span className="font-mono text-[12px] font-bold tabular-nums">{coverage.match_rate_pct}%</span>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────────

function Scroll({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4">{children}</div>;
}

function Card({ title, children, framed, tone }: { title: ReactNode; children: ReactNode; framed?: boolean; tone?: "warn" }) {
  const cls = tone === "warn"
    ? "border-[oklch(86%_0.18_88/0.25)] bg-[linear-gradient(135deg,oklch(20%_0.06_88/0.4),oklch(18%_0.05_305/0.5))]"
    : "border-[oklch(28%_0.02_250/0.55)] bg-[oklch(22%_0.02_250)]";
  return (
    <div className={`rounded-xl p-4 border ${cls} ${framed ? "relative overflow-hidden" : ""}`}>
      {framed && <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[oklch(82%_0.17_86)] to-transparent" />}
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[oklch(58%_0.014_250)]">{title}</div>
      {children}
    </div>
  );
}

function AttentionTile({ pinClass, label, count, desc, cta, tone }: { pinClass: string; label: string; count: number; desc: string; cta: string; tone: "warn" | "violet" }) {
  const numCls = tone === "warn" ? "text-[oklch(82%_0.17_86)]" : "text-[oklch(72%_0.18_305)]";
  const ctaCls = tone === "warn" ? "text-[oklch(82%_0.17_86)]" : "text-[oklch(72%_0.18_305)]";
  const borderCls = tone === "warn" ? "border-[oklch(86%_0.18_88/0.4)]" : "border-[oklch(72%_0.18_305/0.4)]";
  return (
    <div className={`rounded-[10px] border ${borderCls} bg-[oklch(14%_0.012_250/0.5)] p-3`}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.07em] text-[oklch(58%_0.014_250)]">
        <span className={`block h-3 w-3 ${pinClass}`} />{label}
      </div>
      <div className={`mt-1.5 font-display text-2xl font-extrabold leading-none tabular-nums ${numCls}`}>{count}</div>
      <div className="mt-1 text-[10.5px] leading-snug text-[oklch(58%_0.014_250)]">{desc}</div>
      <button className={`mt-2 inline-flex items-center gap-1 text-[10.5px] font-bold ${ctaCls}`}>{cta}</button>
    </div>
  );
}

function KpiTile({ v, l, tone }: { v: string; l: string; tone?: "accent" | "violet" }) {
  const cls = tone === "accent"
    ? "text-[oklch(78%_0.155_234)]"
    : tone === "violet"
    ? "text-[oklch(72%_0.18_305)]"
    : "text-[oklch(96%_0.008_250)]";
  return (
    <div className="flex flex-col">
      <span className={`font-mono text-[14.5px] font-semibold tabular-nums ${cls}`}>{v}</span>
      <span className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-[oklch(58%_0.014_250)]">{l}</span>
    </div>
  );
}

function CovTile({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const valCls = tone === "good"
    ? "text-[oklch(76%_0.16_158)]"
    : tone === "warn"
    ? "text-[oklch(82%_0.17_86)]"
    : tone === "bad"
    ? "text-[oklch(68%_0.21_25)]"
    : "text-[oklch(96%_0.008_250)]";
  return (
    <div className="rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] p-2.5">
      <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-[oklch(58%_0.014_250)]">{label}</div>
      <div className={`mt-1 font-display text-[18px] font-extrabold tabular-nums ${valCls}`}>{value}</div>
    </div>
  );
}

function MatchLegendRow({ color, label, n, total }: { color: string; label: string; n: number; total: number }) {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} />
      <span className="flex-1 text-[10.5px] text-[oklch(76%_0.012_250)]">{label}</span>
      <span className="font-mono text-[10.5px] font-semibold tabular-nums">{n}</span>
      <span className="w-7 text-right font-mono text-[9.5px] text-[oklch(58%_0.014_250)]">{pct}%</span>
    </div>
  );
}

function ActivitySparkline({ buckets, showToday }: { buckets: DailyBucket[]; showToday?: boolean }) {
  if (!buckets.length) return <p className="text-[11px] text-[oklch(58%_0.014_250)]">No activity yet.</p>;
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div>
      <svg width="100%" height="72" viewBox={`0 0 ${buckets.length * 20} 72`} preserveAspectRatio="none" className="overflow-visible">
        {buckets.map((b, i) => {
          const h = Math.max(Math.round((b.total / max) * 58), b.total > 0 ? 3 : 1);
          const isToday = showToday && b.day === today;
          return (
            <g key={b.day}>
              <rect
                x={i * 20 + 2} y={64 - h} width="16" height={h} rx="2"
                fill={isToday ? "oklch(78% 0.155 234)" : "oklch(78% 0.155 234 / 0.5)"}
              />
              {isToday && (
                <rect x={i * 20 + 2} y={64 - h} width="16" height={h} rx="2"
                  fill="none" stroke="oklch(78% 0.155 234)" strokeWidth="1" />
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-[oklch(42%_0.014_250)]">
        <span>{buckets[0]?.day?.slice(5)}</span>
        <span className="text-[oklch(78%_0.155_234)]">today</span>
      </div>
    </div>
  );
}

function DonutBreakdown({ total, matchCounts }: { total: number; matchCounts: MatchStatusCounts }) {
  let offset = 0;
  const m1Pct = total > 0 ? (matchCounts.m1_count / total) * 100 : 0;
  const f1Pct = total > 0 ? (matchCounts.f1_count / total) * 100 : 0;
  const r1Pct = total > 0 ? (matchCounts.r1_count / total) * 100 : 0;
  const slices = [
    { pct: m1Pct, color: "#ffffff" },
    { pct: f1Pct, color: "#fde047" },
    { pct: r1Pct, color: "#a855f7" },
  ];
  return (
    <svg viewBox="0 0 36 36" className="-rotate-90 h-20 w-20 flex-shrink-0">
      <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="oklch(28% 0.02 250 / 0.5)" strokeWidth="3.5" />
      {slices.map((s, i) => {
        if (s.pct <= 0) return null;
        const el = (
          <circle
            key={i}
            cx="18" cy="18" r="15.915"
            fill="transparent"
            stroke={s.color}
            strokeWidth="3.5"
            strokeDasharray={`${s.pct} ${100 - s.pct}`}
            strokeDashoffset={`-${offset}`}
            opacity="0.85"
          />
        );
        offset += s.pct;
        return el;
      })}
    </svg>
  );
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function DowChart({ buckets }: { buckets: DowBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.total));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-1">
        {DOW_LABELS.map((label, d) => {
          const bucket = buckets.find((b) => b.dow === d);
          const total = bucket?.total ?? 0;
          const pct = Math.round((total / max) * 100);
          const isWeekend = d === 0 || d === 6;
          return (
            <div key={d} className="flex flex-col items-center gap-1">
              <div className="relative flex h-12 w-full items-end overflow-hidden rounded bg-[oklch(20%_0.016_250)]">
                <div
                  className={`w-full rounded ${isWeekend ? "bg-[oklch(72%_0.18_305/0.55)]" : "bg-[oklch(78%_0.155_234/0.6)]"} transition-all`}
                  style={{ height: `${Math.max(pct, total > 0 ? 6 : 0)}%` }}
                />
              </div>
              <span className="text-[8.5px] font-semibold text-[oklch(42%_0.014_250)]">{label}</span>
              <span className="font-mono text-[9px] text-[oklch(76%_0.012_250)]">{total}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[9.5px] text-[oklch(42%_0.014_250)]">Purple = weekends · Blue = weekdays</p>
    </div>
  );
}

function HourChart({ buckets }: { buckets: HourBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.total));
  return (
    <div>
      <div className="flex items-end gap-px h-12">
        {Array.from({ length: 24 }, (_, h) => {
          const bucket = buckets.find((b) => b.hour === h);
          const total = bucket?.total ?? 0;
          const heightPct = Math.max((total / max) * 100, total > 0 ? 4 : 0);
          const isNight = h < 6 || h >= 20;
          return (
            <div
              key={h}
              className={`flex-1 rounded-sm ${isNight ? "bg-[oklch(72%_0.18_305/0.4)]" : "bg-[oklch(78%_0.155_234/0.65)]"} transition-all`}
              style={{ height: `${heightPct}%` }}
              title={`${h}:00 — ${total} pts`}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[8.5px] text-[oklch(42%_0.014_250)]">
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>
      <p className="mt-1 text-[9.5px] text-[oklch(42%_0.014_250)]">Purple = night (before 6am / after 8pm) · Blue = daytime</p>
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-center text-[12px] text-[oklch(58%_0.014_250)]">
      <span>{label}</span>
    </div>
  );
}
