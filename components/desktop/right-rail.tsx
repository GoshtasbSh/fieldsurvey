"use client";

import { useState, type ReactNode } from "react";
import { Activity, BarChart3, Users, MousePointer2 } from "lucide-react";
import type { MatchStatusCounts } from "@/lib/match/status";
import type { StatusRow } from "./left-rail";

export type RightRailTab = "pulse" | "analyze" | "team" | "inspect";

type Props = {
  matchCounts: MatchStatusCounts;
  statuses: StatusRow[];
  pointsTotal: number;
  todayDelta: number;
  unreadChats?: number;
};

/**
 * Right rail: 4 tabs — Pulse, Analyze, Team, Inspect.
 * Surveyors live in Team (NOT in the left rail).
 * Survey responses are admin-visible on desktop only.
 */
export function DesktopRightRail({ matchCounts, statuses, pointsTotal, todayDelta, unreadChats }: Props) {
  const [tab, setTab] = useState<RightRailTab>("pulse");

  return (
    <aside className="flex w-[360px] flex-col overflow-hidden border-l border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)]">
      <nav className="grid grid-cols-4 gap-1 border-b border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)] px-3.5 py-3">
        {(
          [
            { key: "pulse", label: "Pulse", Icon: Activity, badge: undefined as number | undefined },
            { key: "analyze", label: "Analyze", Icon: BarChart3, badge: undefined as number | undefined },
            { key: "team", label: "Team", Icon: Users, badge: unreadChats },
            { key: "inspect", label: "Inspect", Icon: MousePointer2, badge: undefined as number | undefined },
          ] as const
        ).map(({ key, label, Icon, badge }) => {
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
                <span className="absolute right-[18%] top-[5px] inline-flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-[oklch(17%_0.014_250)] bg-[oklch(68%_0.21_25)] px-1 font-mono text-[9.5px] font-bold text-white">
                  {badge}
                </span>
              )}
              {on && <span className="absolute -bottom-3.5 left-[30%] right-[30%] h-0.5 rounded-t bg-[oklch(78%_0.155_234)] shadow-[0_0_8px_oklch(78%_0.155_234/0.35)]" />}
            </button>
          );
        })}
      </nav>

      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4">
        {tab === "pulse" && <PulseTab matchCounts={matchCounts} statuses={statuses} pointsTotal={pointsTotal} todayDelta={todayDelta} />}
        {tab === "analyze" && <PlaceholderPanel label="Analytics deck — coming in next slice" />}
        {tab === "team" && <PlaceholderPanel label="Team + chat — coming in next slice" />}
        {tab === "inspect" && <PlaceholderPanel label="Click a pin to inspect" />}
      </div>
    </aside>
  );
}

function PulseTab({
  matchCounts,
  statuses,
  pointsTotal,
  todayDelta,
}: {
  matchCounts: MatchStatusCounts;
  statuses: StatusRow[];
  pointsTotal: number;
  todayDelta: number;
}) {
  const attentionTotal = matchCounts.f1_count + matchCounts.r1_count;
  return (
    <>
      {attentionTotal > 0 && (
        <Card
          framed
          tone="warn"
          title={
            <span className="flex items-center gap-2.5">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[oklch(86%_0.18_88/0.4)] bg-[oklch(86%_0.18_88/0.18)] text-[oklch(82%_0.17_86)]">
                <Activity className="h-3.5 w-3.5" strokeWidth={1.7} />
              </span>
              <span>
                <span className="block font-display text-[13px] font-extrabold">Needs attention</span>
                <span className="block text-[10.5px] text-[oklch(58%_0.014_250)]">{attentionTotal} points have incomplete data</span>
              </span>
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-2.5">
            <AttentionTile tone="warn" pinClass="bg-[oklch(78%_0.165_70)] ring-2 ring-[#fde047]" label="F1 · Field only" count={matchCounts.f1_count} desc="Collected but no Qualtrics response" cta="Chase responses →" />
            <AttentionTile tone="violet" pinClass="bg-[oklch(72%_0.18_305)] rounded-[3px] ring-2 ring-[#a855f7]" label="R1 · Response only" count={matchCounts.r1_count} desc="Response in, no field visit yet" cta="Assign surveyor →" />
          </div>
        </Card>
      )}

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
          <KpiTile v={`${Math.round((matchCounts.m1_count / Math.max(pointsTotal, 1)) * 100)}%`} l="Done" />
          <KpiTile v={String(matchCounts.m1_count)} l="M1 matched" tone="accent" />
          <KpiTile v={String(matchCounts.r1_count)} l="R1 awaiting" tone="violet" />
        </div>
      </div>

      <Card title="Status breakdown">
        <div className="space-y-2">
          {statuses.map((s) => (
            <div key={s.id} className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="flex-1 text-[11.5px] text-[oklch(76%_0.012_250)]">{s.label}</span>
              <span className="font-mono text-[11px] font-semibold tabular-nums">{s.count}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function Card({ title, children, framed, tone }: { title: ReactNode; children: ReactNode; framed?: boolean; tone?: "warn" }) {
  const base = "rounded-xl p-4 border";
  const cls =
    tone === "warn"
      ? "border-[oklch(86%_0.18_88/0.25)] bg-[linear-gradient(135deg,oklch(20%_0.06_88/0.4),oklch(18%_0.05_305/0.5))]"
      : "border-[oklch(28%_0.02_250/0.55)] bg-[oklch(22%_0.02_250)]";
  return (
    <div className={`${base} ${cls} ${framed ? "relative overflow-hidden" : ""}`}>
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
        <span className={`block h-3 w-3 ${pinClass}`} />
        {label}
      </div>
      <div className={`mt-1.5 font-display text-2xl font-extrabold leading-none tabular-nums ${numCls}`}>{count}</div>
      <div className="mt-1 text-[10.5px] leading-snug text-[oklch(58%_0.014_250)]">{desc}</div>
      <button className={`mt-2 inline-flex items-center gap-1 text-[10.5px] font-bold ${ctaCls}`}>{cta}</button>
    </div>
  );
}

function KpiTile({ v, l, tone }: { v: string; l: string; tone?: "accent" | "violet" }) {
  const cls = tone === "accent" ? "text-[oklch(78%_0.155_234)]" : tone === "violet" ? "text-[oklch(72%_0.18_305)]" : "text-[oklch(96%_0.008_250)]";
  return (
    <div className="flex flex-col">
      <span className={`font-mono text-[14.5px] font-semibold tabular-nums ${cls}`}>{v}</span>
      <span className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-[oklch(58%_0.014_250)]">{l}</span>
    </div>
  );
}

function PlaceholderPanel({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-center text-[12px] text-[oklch(58%_0.014_250)]">
      <span>{label}</span>
    </div>
  );
}
