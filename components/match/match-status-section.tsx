"use client";

import { useState } from "react";
import type { MatchStatusCounts, MatchStatus } from "@/lib/match/status";
import { MATCH_LABEL, MATCH_DESCRIPTION, MATCH_ACTION } from "@/lib/match/status";

type Props = {
  counts: MatchStatusCounts;
  active: MatchStatus | null;
  onToggle: (m: MatchStatus | null) => void;
};

/**
 * Left-rail Match Status section. Click a row to SOLO that group on
 * the map. Click the active row again to clear the filter.
 *
 * Symbol previews use the SAME visual encoding the map uses, so the
 * legend is self-documenting (Keystone pattern).
 */
export function MatchStatusSection({ counts, active, onToggle }: Props) {
  const total = counts.total_with_status;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  const rows: Array<{
    key: MatchStatus;
    count: number;
    badge: "ok" | "warn" | "act";
    pinClass: string;
  }> = [
    { key: "M1", count: counts.m1_count, badge: "ok", pinClass: "bg-[oklch(76%_0.16_158)] ring-2 ring-white shadow-[0_0_8px_oklch(96%_0.008_250/0.4)]" },
    { key: "F1", count: counts.f1_count, badge: "warn", pinClass: "bg-[oklch(78%_0.165_70)] ring-[2.5px] ring-[#fde047] shadow-[0_0_10px_oklch(86%_0.18_88/0.5)]" },
    { key: "R1", count: counts.r1_count, badge: "act", pinClass: "bg-[oklch(72%_0.18_305)] rounded-[3px] ring-[2.5px] ring-[#a855f7] shadow-[0_0_10px_oklch(72%_0.18_305/0.55)]" },
  ];

  return (
    <div className="px-3.5 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-[oklch(58%_0.014_250)] before:h-[3px] before:w-[3px] before:rounded-full before:bg-[oklch(78%_0.155_234)] before:shadow-[0_0_5px_oklch(78%_0.155_234/0.35)]">
          Match Status
        </h4>
        <span title="How field points relate to imported survey responses" className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-[oklch(20%_0.016_250)] text-[9px] font-bold text-[oklch(58%_0.014_250)]">
          ?
        </span>
      </div>

      {/* Flow proportions bar */}
      <div className="mx-1 mb-3 flex h-1.5 overflow-hidden rounded-full bg-[oklch(24%_0.018_250)]">
        <div className="h-full bg-gradient-to-r from-[oklch(76%_0.16_158)] to-[oklch(80%_0.13_158)] transition-all" style={{ width: `${pct(counts.m1_count)}%` }} />
        <div className="h-full bg-gradient-to-r from-[oklch(78%_0.165_70)] to-[oklch(82%_0.17_86)] transition-all" style={{ width: `${pct(counts.f1_count)}%` }} />
        <div className="h-full bg-gradient-to-r from-[oklch(68%_0.18_305)] to-[oklch(72%_0.18_305)] transition-all" style={{ width: `${pct(counts.r1_count)}%` }} />
      </div>

      {rows.map((r) => {
        const isOn = active === r.key;
        const isDim = active !== null && !isOn;
        const numColor = r.key === "M1" ? "text-[oklch(96%_0.008_250)]" : r.key === "F1" ? "text-[oklch(82%_0.17_86)]" : "text-[oklch(72%_0.18_305)]";
        return (
          <button
            key={r.key}
            onClick={() => onToggle(isOn ? null : r.key)}
            className={`mb-1 grid w-full grid-cols-[28px_1fr_auto] items-center gap-2.5 rounded-[10px] border border-transparent p-2.5 text-left transition ${
              isOn ? "border-[oklch(78%_0.155_234/0.25)] bg-gradient-to-r from-[oklch(78%_0.155_234/0.12)] to-[oklch(78%_0.155_234/0.02)]" : "hover:border-[oklch(28%_0.02_250/0.55)] hover:bg-[oklch(20%_0.016_250)]"
            } ${isDim ? "opacity-35" : ""}`}
          >
            <span className="inline-flex h-[26px] w-[26px] items-center justify-center">
              <span className={`block h-3 w-3 ${r.pinClass}`} style={{ borderRadius: r.key === "R1" ? "3px" : "9999px" }} />
            </span>
            <span className="flex min-w-0 flex-col gap-px">
              <span className="flex items-center gap-1.5 font-display text-[12.5px] font-bold tracking-[-0.005em] text-[oklch(96%_0.008_250)]">
                {MATCH_LABEL[r.key]}
                <span className={`rounded px-1 py-px font-mono text-[9.5px] font-bold ${isOn ? "bg-[oklch(78%_0.155_234/0.2)] text-[oklch(78%_0.155_234)]" : "bg-[oklch(24%_0.018_250)] text-[oklch(58%_0.014_250)]"}`}>
                  {r.key}
                </span>
              </span>
              <span className="text-[10.5px] leading-snug text-[oklch(58%_0.014_250)]">{MATCH_DESCRIPTION[r.key]}</span>
              <span
                className={`mt-1 inline-flex w-fit items-center gap-1 rounded px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.04em] ${
                  r.badge === "ok"
                    ? "bg-[oklch(76%_0.16_158/0.15)] text-[oklch(76%_0.16_158)]"
                    : r.badge === "warn"
                      ? "bg-[oklch(86%_0.18_88/0.15)] text-[oklch(82%_0.17_86)]"
                      : "bg-[oklch(72%_0.18_305/0.15)] text-[oklch(72%_0.18_305)]"
                }`}
              >
                {r.badge === "ok" ? "✓ " : r.badge === "warn" ? "⚠ " : "→ "}
                {MATCH_ACTION[r.key]}
              </span>
            </span>
            <span className="flex flex-col items-end leading-tight">
              <span className={`font-mono text-[18px] font-bold tabular-nums ${numColor}`}>{r.count}</span>
              <span className="font-mono text-[9.5px] text-[oklch(58%_0.014_250)]">{pct(r.count)}%</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function useMatchStatusFilter() {
  const [active, setActive] = useState<MatchStatus | null>(null);
  return { active, setActive };
}
