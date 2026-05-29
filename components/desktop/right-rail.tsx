"use client";

import { useState, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Users,
  MousePointer2,
  ChevronRight,
  TrendingUp,
  Clock,
  Sparkles,
  ListChecks,
} from "lucide-react";
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
export type CanvassBlob = {
  enabled: boolean;
  total: number;
  visited: number;
  skipped: number;
  pct: number;
  by_surveyor: Array<{ visited_by: string | null; count: number }>;
};

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
  /** False for viewer role — chat composer is hidden, only read is allowed. */
  canWriteChat?: boolean;
  /** When non-null, Pulse swaps its KPI bento for a canvass-completion block. */
  canvass?: CanvassBlob | null;
  onCollapse: () => void;
};

export function DesktopRightRail({
  projectId, currentUserId, matchCounts, statuses, pointsTotal, todayDelta,
  unreadChats, daily = [], hourly = [], dow = [], surveyors = [], coverage,
  chatMembers = [], initialChat = [], canWriteChat = true, canvass = null, onCollapse,
}: Props) {
  const [tab, setTab] = useState<RightRailTab>("pulse");

  return (
    <aside className="flex h-full w-[360px] flex-col overflow-hidden border-l border-[var(--bento-rule)] bg-[var(--bento-bg)]">
      {/* Tab bar — Bento segmented (full pills at top, no bottom indicator) */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="bento-panel flex flex-1 gap-1 p-1">
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
                className={`bento-focus relative flex flex-1 items-center justify-center gap-1.5 rounded-[10px] py-2 text-[11.5px] font-semibold transition ${
                  on
                    ? "bg-[var(--bento-ink-1)] text-[var(--bento-bg)] shadow-[var(--bento-shadow-xs)]"
                    : "text-[var(--bento-ink-2)] hover:bg-[var(--bento-surface-2)] hover:text-[var(--bento-ink-1)]"
                }`}
              >
                <Icon className="h-[14px] w-[14px]" strokeWidth={1.8} />
                <span>{label}</span>
                {typeof badge === "number" && badge > 0 && (
                  <span
                    className="absolute -top-1 right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[9.5px] font-bold text-white"
                    style={{ background: "var(--bento-danger)" }}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          onClick={onCollapse}
          className="bento-focus inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[var(--bento-rule)] bg-[var(--bento-surface)] text-[var(--bento-ink-3)] transition hover:bg-[var(--bento-surface-3)] hover:text-[var(--bento-ink-1)]"
          aria-label="Collapse panel"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>

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
              canvass={canvass}
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
            ? <ChatPanel projectId={projectId} currentUserId={currentUserId} members={chatMembers} initial={initialChat} canWrite={canWriteChat} />
            : <Placeholder label="Sign in to chat" />
        )}
        {tab === "inspect" && <Placeholder label="Click a pin on the map to inspect it" />}
      </div>

      {/* GeoChatBot placeholder slot — bottom-right (locked decision Q8). */}
      {/* No LLM dependency in M4; future plug-in replaces the body without touching the mount. */}
      <GeoChatBotSlot />
    </aside>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// GeoChatBot placeholder — KeyStone parity, bottom-right of dashboard
// ──────────────────────────────────────────────────────────────────────────────

function GeoChatBotSlot() {
  return (
    <div className="border-t border-[var(--bento-rule)] bg-[var(--bento-bg)] p-3">
      <div
        className="bento-panel relative overflow-hidden p-3.5"
        style={{
          background:
            "linear-gradient(135deg, var(--bento-accent-soft), var(--bento-surface))",
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[12px]"
            style={{
              background: "var(--bento-accent)",
              color: "var(--bento-on-accent)",
            }}
          >
            <Sparkles className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[12.5px] font-semibold text-[var(--bento-ink-1)]">
              Ask GeoChatBot
            </div>
            <div className="text-[10.5px] text-[var(--bento-ink-3)]">
              Natural-language analyst · coming soon
            </div>
          </div>
          <span
            className="bento-chip font-mono text-[10px]"
            style={{ color: "var(--bento-ink-3)" }}
          >
            Soon
          </span>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PULSE TAB — operational, real-time snapshot of field activity
// ──────────────────────────────────────────────────────────────────────────────

function PulseTab({
  matchCounts, statuses, pointsTotal, todayDelta, daily, canvass,
}: {
  matchCounts: MatchStatusCounts;
  statuses: StatusRow[];
  pointsTotal: number;
  todayDelta: number;
  daily: DailyBucket[];
  canvass: CanvassBlob | null;
}) {
  const attentionTotal = matchCounts.f1_count + matchCounts.r1_count;
  return (
    <>
      {canvass?.enabled && (
        <CanvassCompletion blob={canvass} />
      )}
      {/* Needs attention */}
      {attentionTotal > 0 && (
        <Card framed tone="warn" title={
          <span className="flex items-center gap-2.5">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[oklch(86%_0.18_88/0.4)] bg-[oklch(86%_0.18_88/0.18)] text-[oklch(82%_0.17_86)]">
              <Activity className="h-3.5 w-3.5" strokeWidth={1.7} />
            </span>
            <span>
              <span className="block font-display text-[13px] font-extrabold">Needs attention</span>
              <span className="block text-[10.5px] text-[var(--shell-text-muted)]">{attentionTotal} points have incomplete data</span>
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
      <div className="bento-panel relative overflow-hidden p-4">
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full"
          style={{ background: "var(--bento-accent-soft)" }}
        />
        <div className="relative grid grid-cols-[1fr_auto] items-end gap-3.5">
          <div>
            <div className="bento-label mb-1.5">Points collected</div>
            <div className="bento-num font-display text-[40px] font-extrabold leading-none tracking-[-0.025em] text-[var(--bento-ink-1)]">
              {pointsTotal}
            </div>
          </div>
          {todayDelta > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-bold"
              style={{
                background: "var(--bento-success-soft)",
                color: "var(--bento-success)",
              }}
            >
              ▲ +{todayDelta} today
            </span>
          )}
        </div>
        <div
          className="relative mt-3 grid grid-cols-3 gap-1.5 border-t pt-3"
          style={{ borderColor: "var(--bento-rule)" }}
        >
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
                <span className="text-[11.5px] font-semibold text-[var(--shell-text-2)]">{s.label}</span>
                <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[var(--shell-3)]">
                  <div className="h-full rounded-full" style={{ width: `${Math.round(s.pct * 100)}%`, background: s.color }} />
                </div>
              </div>
              <div className="text-right">
                <span className="font-mono text-[11.5px] font-semibold tabular-nums text-[var(--shell-text)]">{s.count}</span>
                <span className="block font-mono text-[9px] text-[var(--shell-text-muted)]">{Math.round(s.pct * 100)}%</span>
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
          <p className="text-[11px] text-[var(--shell-text-muted)]">No collectors yet.</p>
        ) : (
          <div className="space-y-2">
            {surveyors.slice(0, 8).map((s, i) => {
              const max = surveyors[0]?.count || 1;
              const pct = Math.round((s.count / max) * 100);
              return (
                <div key={s.collector_id ?? `u_${i}`} className="grid grid-cols-[20px_1fr_auto] items-center gap-2">
                  <span className="font-mono text-[11px] font-bold text-[var(--shell-text-muted)] tabular-nums">{i + 1}</span>
                  <div>
                    <div className="text-[12px] font-semibold text-[var(--shell-text)]">{s.name}</div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--shell-3)]">
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
          <div className="mt-3 rounded-lg bg-[var(--shell-2)] px-3 py-2">
            <div className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.07em] text-[var(--shell-text-muted)]">Match rate progress</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 overflow-hidden rounded-full bg-[var(--shell-3)]">
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

function Card({ title, children, tone }: { title: ReactNode; children: ReactNode; framed?: boolean; tone?: "warn" }) {
  const toneStyle =
    tone === "warn"
      ? { background: "var(--bento-warning-soft)", borderColor: "transparent" }
      : undefined;
  return (
    <div
      className="bento-panel p-4"
      style={toneStyle}
    >
      <div className="bento-label mb-3">{title}</div>
      {children}
    </div>
  );
}

function AttentionTile({ pinClass, label, count, desc, cta, tone }: { pinClass: string; label: string; count: number; desc: string; cta: string; tone: "warn" | "violet" }) {
  const numCls = tone === "warn" ? "text-[oklch(82%_0.17_86)]" : "text-[oklch(72%_0.18_305)]";
  const ctaCls = tone === "warn" ? "text-[oklch(82%_0.17_86)]" : "text-[oklch(72%_0.18_305)]";
  const borderCls = tone === "warn" ? "border-[oklch(86%_0.18_88/0.4)]" : "border-[oklch(72%_0.18_305/0.4)]";
  return (
    <div className={`rounded-[10px] border ${borderCls} bg-[var(--shell-base-alpha-65)] p-3`}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--shell-text-muted)]">
        <span className={`block h-3 w-3 ${pinClass}`} />{label}
      </div>
      <div className={`mt-1.5 font-display text-2xl font-extrabold leading-none tabular-nums ${numCls}`}>{count}</div>
      <div className="mt-1 text-[10.5px] leading-snug text-[var(--shell-text-muted)]">{desc}</div>
      <button className={`mt-2 inline-flex items-center gap-1 text-[10.5px] font-bold ${ctaCls}`}>{cta}</button>
    </div>
  );
}

function KpiTile({ v, l, tone }: { v: string; l: string; tone?: "accent" | "violet" }) {
  const color =
    tone === "accent"
      ? "var(--bento-accent)"
      : tone === "violet"
        ? "var(--bento-magenta)"
        : "var(--bento-ink-1)";
  return (
    <div className="flex flex-col">
      <span className="bento-num font-mono text-[14.5px] font-semibold" style={{ color }}>
        {v}
      </span>
      <span className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-[var(--bento-ink-3)]">
        {l}
      </span>
    </div>
  );
}

function CovTile({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const valColor =
    tone === "good"
      ? "var(--bento-success)"
      : tone === "warn"
        ? "var(--bento-warning)"
        : tone === "bad"
          ? "var(--bento-danger)"
          : "var(--bento-ink-1)";
  return (
    <div className="bento-panel-inset p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--bento-ink-3)]">
        {label}
      </div>
      <div
        className="bento-num mt-1 font-display text-[18px] font-extrabold"
        style={{ color: valColor }}
      >
        {value}
      </div>
    </div>
  );
}

function MatchLegendRow({ color, label, n, total }: { color: string; label: string; n: number; total: number }) {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} />
      <span className="flex-1 text-[10.5px] text-[var(--shell-text-2)]">{label}</span>
      <span className="font-mono text-[10.5px] font-semibold tabular-nums">{n}</span>
      <span className="w-7 text-right font-mono text-[9.5px] text-[var(--shell-text-muted)]">{pct}%</span>
    </div>
  );
}

function ActivitySparkline({ buckets, showToday }: { buckets: DailyBucket[]; showToday?: boolean }) {
  if (!buckets.length) return <p className="text-[11px] text-[var(--shell-text-muted)]">No activity yet.</p>;
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
      <div className="mt-1 flex justify-between font-mono text-[9px] text-[var(--shell-text-muted)]">
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
              <div className="relative flex h-12 w-full items-end overflow-hidden rounded bg-[var(--shell-2)]">
                <div
                  className={`w-full rounded ${isWeekend ? "bg-[oklch(72%_0.18_305/0.55)]" : "bg-[oklch(78%_0.155_234/0.6)]"} transition-all`}
                  style={{ height: `${Math.max(pct, total > 0 ? 6 : 0)}%` }}
                />
              </div>
              <span className="text-[8.5px] font-semibold text-[var(--shell-text-muted)]">{label}</span>
              <span className="font-mono text-[9px] text-[var(--shell-text-2)]">{total}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[9.5px] text-[var(--shell-text-muted)]">Purple = weekends · Blue = weekdays</p>
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
      <div className="mt-1.5 flex justify-between font-mono text-[8.5px] text-[var(--shell-text-muted)]">
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>
      <p className="mt-1 text-[9.5px] text-[var(--shell-text-muted)]">Purple = night (before 6am / after 8pm) · Blue = daytime</p>
    </div>
  );
}

function CanvassCompletion({ blob }: { blob: CanvassBlob }) {
  const pct = Math.round(blob.pct * 1000) / 10;
  const remaining = Math.max(0, blob.total - blob.visited - blob.skipped);
  const tone =
    blob.pct >= 0.8
      ? "var(--bento-success)"
      : blob.pct >= 0.4
        ? "var(--bento-accent)"
        : "var(--bento-warning)";
  return (
    <div className="bento-panel relative overflow-hidden p-4">
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full"
        style={{ background: "var(--bento-accent-soft)" }}
      />
      <div className="relative flex items-center gap-3">
        <span
          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[12px]"
          style={{ background: tone, color: "var(--bento-on-accent)" }}
        >
          <ListChecks className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="bento-label">Canvass progress</div>
          <div className="font-display text-[22px] font-extrabold leading-none tracking-[-0.025em] text-[var(--bento-ink-1)]">
            {pct.toFixed(1)}%
          </div>
        </div>
        <span
          className="rounded-full px-2.5 py-1 font-mono text-[11px] font-bold"
          style={{ background: "var(--bento-surface-2)", color: "var(--bento-ink-2)" }}
        >
          {blob.visited.toLocaleString()} / {blob.total.toLocaleString()}
        </span>
      </div>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-[var(--bento-surface-3)]">
        <div
          className="h-full transition-all"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: tone }}
        />
      </div>
      <div
        className="relative mt-3 grid grid-cols-3 gap-1.5 border-t pt-3"
        style={{ borderColor: "var(--bento-rule)" }}
      >
        <KpiTile v={blob.visited.toLocaleString()} l="Visited" tone="accent" />
        <KpiTile v={remaining.toLocaleString()} l="Remaining" />
        <KpiTile v={blob.skipped.toLocaleString()} l="Skipped" />
      </div>
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-center text-[12px] text-[var(--shell-text-muted)]">
      <span>{label}</span>
    </div>
  );
}
