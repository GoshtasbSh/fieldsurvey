"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, MapPin, Activity, Group, Map as MapIcon, Star, Settings, ChevronLeft, PanelLeftClose } from "lucide-react";
import { MatchStatusSection } from "@/components/match/match-status-section";
import type { MatchStatusCounts, MatchStatus } from "@/lib/match/status";

export type StatusRow = {
  id: string;
  label: string;
  color: string;
  icon: string | null;
  count: number;
  pct: number;
};

type LayerKey = "points" | "heatmap" | "clusters" | "boundary";

type Props = {
  projectId: string;
  projectName: string;
  projectMeta: { points: number; responses: number; active: number };
  matchCounts: MatchStatusCounts;
  statuses: StatusRow[];
  activeMatch: MatchStatus | null;
  setActiveMatch: (m: MatchStatus | null) => void;
  activeStatusIds: Set<string>;
  setActiveStatusIds: (ids: Set<string>) => void;
  visibleStatusIds: Set<string>;
  setVisibleStatusIds: (ids: Set<string>) => void;
  layers: Record<LayerKey, boolean>;
  setLayers: (l: Record<LayerKey, boolean>) => void;
  dateRange: "today" | "7d" | "30d" | "all";
  setDateRange: (d: "today" | "7d" | "30d" | "all") => void;
  onCollapse: () => void;
};

export function DesktopLeftRail({
  projectId,
  projectName,
  projectMeta,
  matchCounts,
  statuses,
  activeMatch,
  setActiveMatch,
  activeStatusIds,
  setActiveStatusIds,
  visibleStatusIds,
  setVisibleStatusIds,
  layers,
  setLayers,
  dateRange,
  setDateRange,
  onCollapse,
}: Props) {
  return (
    <aside className="flex h-full w-[280px] flex-col overflow-y-auto border-r border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)]">
      {/* Project card */}
      <div className="m-3.5 overflow-hidden rounded-xl border border-[oklch(78%_0.155_234/0.2)] bg-gradient-to-br from-[oklch(20%_0.04_234/0.7)] to-[oklch(18%_0.02_250)] p-3.5 relative">
        {/* Always-visible collapse button — top-right of project card */}
        <button
          onClick={onCollapse}
          className="absolute right-2.5 top-2.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md text-[oklch(42%_0.014_250)] transition hover:bg-[oklch(24%_0.018_250/0.7)] hover:text-[oklch(78%_0.155_234)]"
          aria-label="Collapse panel"
          title="Collapse panel"
        >
          <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,oklch(78%_0.155_234/0.2),transparent_60%)] pointer-events-none" />
        <div className="relative mb-2.5 h-16 overflow-hidden rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(16%_0.014_250)]">
          {/* tiny pin scatter */}
          <span className="absolute h-1 w-1 rounded-full bg-[oklch(76%_0.16_158)] shadow-[0_0_4px_oklch(76%_0.16_158)]" style={{ top: "30%", left: "25%" }} />
          <span className="absolute h-1 w-1 rounded-full bg-[oklch(76%_0.16_158)] shadow-[0_0_4px_oklch(76%_0.16_158)]" style={{ top: "42%", left: "32%" }} />
          <span className="absolute h-1 w-1 rounded-full bg-[oklch(78%_0.165_70)] shadow-[0_0_4px_oklch(78%_0.165_70)]" style={{ top: "50%", left: "18%" }} />
          <span className="absolute h-1 w-1 rounded-full bg-[oklch(72%_0.18_305)] shadow-[0_0_4px_oklch(72%_0.18_305)]" style={{ top: "35%", left: "65%" }} />
          <span className="absolute h-1 w-1 rounded-full bg-[oklch(68%_0.21_25)] shadow-[0_0_4px_oklch(68%_0.21_25)]" style={{ top: "55%", left: "70%" }} />
        </div>
        <h3 className="mb-px font-display text-[13.5px] font-extrabold">{projectName}</h3>
        <div className="font-mono text-[10.5px] text-[oklch(58%_0.014_250)]">
          <b className="font-semibold text-[oklch(96%_0.008_250)]">{projectMeta.points}</b> field ·{" "}
          <b className="font-semibold text-[oklch(96%_0.008_250)]">{projectMeta.responses}</b> resp ·{" "}
          <b className="font-semibold text-[oklch(96%_0.008_250)]">{projectMeta.active}</b> active
        </div>
      </div>

      {/* Match Status */}
      <MatchStatusSection counts={matchCounts} active={activeMatch} onToggle={setActiveMatch} />

      {/* Status (color) */}
      <div className="px-3.5 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-[oklch(58%_0.014_250)] before:h-[3px] before:w-[3px] before:rounded-full before:bg-[oklch(78%_0.155_234)] before:shadow-[0_0_5px_oklch(78%_0.155_234/0.35)]">
            Status
          </h4>
          <div className="flex items-center gap-2">
            <button
              className="cursor-pointer text-[10.5px] font-semibold text-[oklch(58%_0.014_250)] transition hover:text-[oklch(78%_0.155_234)]"
              onClick={() => setActiveStatusIds(new Set())}
            >
              All
            </button>
            <Link
              href={`/p/${projectId}/settings`}
              className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[oklch(42%_0.014_250)] transition hover:bg-[oklch(24%_0.018_250)] hover:text-[oklch(78%_0.155_234)]"
              title="Manage statuses"
            >
              <Settings className="h-3 w-3" strokeWidth={1.7} />
            </Link>
          </div>
        </div>
        {statuses.map((s) => {
          const isOn = activeStatusIds.size === 0 || activeStatusIds.has(s.id);
          const isVisible = visibleStatusIds.has(s.id);
          return (
            <div
              key={s.id}
              className={`grid grid-cols-[12px_1fr_auto_22px] items-center gap-2 rounded-[7px] px-2 py-1.5 transition ${
                isOn ? "" : "opacity-45"
              } hover:bg-[oklch(20%_0.016_250)] cursor-pointer`}
              onClick={() => {
                const next = new Set(activeStatusIds);
                if (next.has(s.id)) next.delete(s.id);
                else next.add(s.id);
                setActiveStatusIds(next);
              }}
            >
              <StatusSymbol color={s.color} icon={s.icon} size={10} />
              <span className="text-[11.5px] font-semibold text-[oklch(96%_0.008_250)]">{s.label}</span>
              <span className="row-span-1 col-start-3 flex flex-col items-end leading-tight">
                <span className="font-mono text-[11.5px] font-semibold">{s.count}</span>
                <span className="font-mono text-[9px] text-[oklch(58%_0.014_250)]">{Math.round(s.pct * 100)}%</span>
              </span>
              <button
                className={`inline-flex h-5 w-5 items-center justify-center rounded-md transition ${
                  isVisible ? "text-[oklch(78%_0.155_234)]" : "text-[oklch(42%_0.014_250)]"
                } hover:bg-[oklch(24%_0.018_250)] hover:text-[oklch(96%_0.008_250)]`}
                onClick={(e) => {
                  e.stopPropagation();
                  const next = new Set(visibleStatusIds);
                  if (next.has(s.id)) next.delete(s.id);
                  else next.add(s.id);
                  setVisibleStatusIds(next);
                }}
                aria-label={isVisible ? "Hide" : "Show"}
              >
                {isVisible ? <Eye className="h-3.5 w-3.5" strokeWidth={1.7} /> : <EyeOff className="h-3.5 w-3.5" strokeWidth={1.7} />}
              </button>
              <div className="col-span-2 col-start-2 mt-1 h-[3px] overflow-hidden rounded-full bg-[oklch(24%_0.018_250)]">
                <div className="h-full rounded-full" style={{ width: `${Math.round(s.pct * 100)}%`, background: s.color }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Layers */}
      <div className="px-3.5 pt-3">
        <div className="mb-2 flex items-center">
          <h4 className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-[oklch(58%_0.014_250)] before:h-[3px] before:w-[3px] before:rounded-full before:bg-[oklch(78%_0.155_234)] before:shadow-[0_0_5px_oklch(78%_0.155_234/0.35)]">
            Layers
          </h4>
        </div>
        {(
          [
            { key: "points", label: "Points", Icon: MapPin },
            { key: "heatmap", label: "Heatmap", Icon: Activity },
            { key: "clusters", label: "Clusters", Icon: Group },
            { key: "boundary", label: "Boundary", Icon: MapIcon },
          ] as Array<{ key: LayerKey; label: string; Icon: typeof MapPin }>
        ).map(({ key, label, Icon }) => {
          const isOn = layers[key];
          return (
            <button
              key={key}
              onClick={() => setLayers({ ...layers, [key]: !isOn })}
              className="flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 transition hover:bg-[oklch(20%_0.016_250)]"
            >
              <span
                className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded-md border ${
                  isOn
                    ? "border-[oklch(78%_0.155_234/0.32)] bg-[oklch(78%_0.155_234/0.14)] text-[oklch(78%_0.155_234)]"
                    : "border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] text-[oklch(76%_0.012_250)]"
                }`}
              >
                <Icon className="h-3 w-3" strokeWidth={1.7} />
              </span>
              <span className={`flex-1 text-left text-[11.5px] ${isOn ? "font-semibold text-[oklch(96%_0.008_250)]" : "font-medium text-[oklch(76%_0.012_250)]"}`}>
                {label}
              </span>
              <span
                className={`relative h-3.5 w-[26px] rounded-full border transition ${
                  isOn ? "border-[oklch(78%_0.155_234/0.5)] bg-[oklch(78%_0.155_234/0.35)]" : "border-[oklch(28%_0.02_250/0.55)] bg-[oklch(24%_0.018_250)]"
                }`}
              >
                <span
                  className={`absolute top-px h-2.5 w-2.5 rounded-full transition ${
                    isOn ? "left-[13px] bg-[oklch(78%_0.155_234)] shadow-[0_0_6px_oklch(78%_0.155_234/0.35)]" : "left-px bg-[oklch(58%_0.014_250)]"
                  }`}
                />
              </span>
            </button>
          );
        })}
      </div>

      {/* Date pills */}
      <div className="px-3.5 pt-3">
        <div className="mb-2 flex items-center">
          <h4 className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-[oklch(58%_0.014_250)] before:h-[3px] before:w-[3px] before:rounded-full before:bg-[oklch(78%_0.155_234)] before:shadow-[0_0_5px_oklch(78%_0.155_234/0.35)]">
            Date
          </h4>
        </div>
        <div className="flex gap-1.5 px-1.5">
          {(["today", "7d", "30d", "all"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDateRange(d)}
              className={`flex-1 rounded-md border py-1.5 text-center font-display text-[10.5px] font-bold transition ${
                dateRange === d
                  ? "border-[oklch(78%_0.155_234/0.32)] bg-[oklch(78%_0.155_234/0.16)] text-[oklch(78%_0.155_234)]"
                  : "border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] text-[oklch(76%_0.012_250)] hover:border-[oklch(36%_0.025_250/0.7)] hover:text-[oklch(96%_0.008_250)]"
              }`}
            >
              {d === "today" ? "Today" : d === "all" ? "All" : d}
            </button>
          ))}
        </div>
      </div>

      {/* Footer: saved view + collapse */}
      <div className="mt-auto border-t border-[oklch(28%_0.02_250/0.55)] p-3.5 flex items-center gap-2">
        <button className="flex flex-1 items-center gap-2.5 rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] px-2.5 py-1.5 transition hover:bg-[oklch(24%_0.018_250)]">
          <Star className="h-3.5 w-3.5 text-[oklch(72%_0.18_305)]" strokeWidth={1.7} />
          <span className="flex-1 text-left">
            <span className="block text-[11.5px] font-semibold text-[oklch(96%_0.008_250)]">Needs attention</span>
            <span className="block text-[9.5px] text-[oklch(58%_0.014_250)]">
              F1 + R1 · {matchCounts.f1_count + matchCounts.r1_count} points
            </span>
          </span>
        </button>
        <button
          onClick={onCollapse}
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] text-[oklch(58%_0.014_250)] transition hover:bg-[oklch(24%_0.018_250)] hover:text-[oklch(96%_0.008_250)]"
          aria-label="Collapse panel"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>
    </aside>
  );
}

// ── Status symbol renderer ────────────────────────────────────────────────────

export type StatusSymbolType = "circle" | "square" | "diamond" | "triangle" | "star";

export function StatusSymbol({ color, icon, size = 10 }: { color: string; icon: string | null; size?: number }) {
  const s = size;
  const sym = (icon ?? "circle") as StatusSymbolType;

  if (sym === "square") {
    return <span style={{ display: "inline-block", width: s, height: s, background: color, borderRadius: 2 }} />;
  }
  if (sym === "diamond") {
    return (
      <span style={{ display: "inline-block", width: s, height: s, background: color, transform: "rotate(45deg)", borderRadius: 1 }} />
    );
  }
  if (sym === "triangle") {
    return (
      <span style={{ display: "inline-block", width: 0, height: 0, borderLeft: `${s * 0.55}px solid transparent`, borderRight: `${s * 0.55}px solid transparent`, borderBottom: `${s}px solid ${color}` }} />
    );
  }
  if (sym === "star") {
    return (
      <svg width={s} height={s} viewBox="0 0 20 20" style={{ display: "inline-block" }}>
        <polygon points="10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7" fill={color} />
      </svg>
    );
  }
  // default: circle
  return <span style={{ display: "inline-block", width: s, height: s, background: color, borderRadius: "50%", boxShadow: `0 0 0 2px oklch(14% 0.012 250)` }} />;
}

/** State factory — kept in this file so the rail and consumers share the type. */
export function useLeftRailState(initial?: { dateRange?: Props["dateRange"] }) {
  const [activeMatch, setActiveMatch] = useState<MatchStatus | null>(null);
  const [activeStatusIds, setActiveStatusIds] = useState<Set<string>>(new Set());
  const [visibleStatusIds, setVisibleStatusIds] = useState<Set<string>>(new Set());
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    points: true,
    heatmap: false,
    clusters: false,
    boundary: false,
  });
  const [dateRange, setDateRange] = useState<Props["dateRange"]>(initial?.dateRange ?? "all");
  return {
    activeMatch,
    setActiveMatch,
    activeStatusIds,
    setActiveStatusIds,
    visibleStatusIds,
    setVisibleStatusIds,
    layers,
    setLayers,
    dateRange,
    setDateRange,
  };
}
