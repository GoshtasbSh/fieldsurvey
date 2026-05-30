"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Eye,
  EyeOff,
  MapPin,
  Activity,
  Group,
  Map as MapIcon,
  Star,
  Settings,
  ChevronsLeft,
  Bookmark,
  Sliders,
  ChevronDown,
} from "lucide-react";
import type { MatchStatusCounts, MatchStatus } from "@/lib/match/status";
import {
  SymbologyEditor,
  type SymbologyMap,
} from "@/components/desktop/symbology-editor";

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
  /** Per-status symbology overrides (Q4 locked). */
  symbology?: SymbologyMap;
  setSymbology?: (next: SymbologyMap) => void;
  /** True when current user is owner/admin/surveyor — gates slider editing. */
  canEditSymbology?: boolean;
  onCollapse: () => void;
  /** M7: Saved Views switcher. */
  savedViews?: Array<{ id: string; name: string; description: string | null; role_gate: string }>;
  activeViewId?: string | null;
  onSwitchView?: (viewId: string) => void;
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
  symbology = {},
  setSymbology,
  canEditSymbology = false,
  onCollapse,
  savedViews = [],
  activeViewId = null,
  onSwitchView,
}: Props) {
  // Which status row currently has its sliders open.
  const [openSymbId, setOpenSymbId] = useState<string | null>(null);
  const totalForProgress = Math.max(
    projectMeta.points + matchCounts.r1_count,
    1,
  );
  const completionPct = Math.min(100, Math.round((projectMeta.points / totalForProgress) * 100));
  const matchTotal = matchCounts.m1_count + matchCounts.f1_count + matchCounts.r1_count;

  return (
    <aside className="flex h-full w-[280px] flex-col gap-3 overflow-y-auto border-r border-[var(--bento-rule)] bg-[var(--bento-bg)] p-3">
      {/* ── Project hero card ────────────────────────────────────────── */}
      <div className="bento-panel relative overflow-hidden p-4">
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full"
          style={{ background: "var(--bento-accent-soft)" }}
        />
        <button
          onClick={onCollapse}
          className="bento-focus absolute right-2.5 top-2.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--bento-ink-3)] transition hover:bg-[var(--bento-surface-3)] hover:text-[var(--bento-ink-1)]"
          aria-label="Collapse panel"
          title="Collapse panel"
        >
          <ChevronsLeft className="h-3.5 w-3.5" strokeWidth={2} />
        </button>

        <div className="relative">
          <div className="bento-label">Project · active</div>
          <h3 className="mt-1 font-display text-[16px] font-bold leading-tight tracking-tight text-[var(--bento-ink-1)]">
            {projectName}
          </h3>
          <div className="mt-1 font-mono text-[10.5px] text-[var(--bento-ink-3)]">
            {projectMeta.active} active · canvass mode
          </div>

          {/* KPI grid */}
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="bento-panel-inset py-2">
              <div className="bento-num font-display text-[15px] font-bold text-[var(--bento-ink-1)]">
                {projectMeta.points}
              </div>
              <div className="text-[9.5px] uppercase tracking-wider text-[var(--bento-ink-3)]">
                points
              </div>
            </div>
            <div className="bento-panel-inset py-2">
              <div className="bento-num font-display text-[15px] font-bold text-[var(--bento-ink-1)]">
                {projectMeta.responses}
              </div>
              <div className="text-[9.5px] uppercase tracking-wider text-[var(--bento-ink-3)]">
                resp
              </div>
            </div>
            <div className="bento-panel-inset py-2">
              <div
                className="bento-num font-display text-[15px] font-bold"
                style={{ color: "var(--bento-success)" }}
              >
                {projectMeta.active}
              </div>
              <div className="text-[9.5px] uppercase tracking-wider text-[var(--bento-ink-3)]">
                live
              </div>
            </div>
          </div>

          {/* Progress */}
          <div className="mt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[10.5px] font-medium text-[var(--bento-ink-3)]">
                Completion
              </span>
              <span className="bento-num font-mono text-[10.5px] font-semibold text-[var(--bento-ink-2)]">
                {completionPct}%
              </span>
            </div>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full"
              style={{ background: "var(--bento-rule)" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${completionPct}%`,
                  background:
                    "linear-gradient(90deg, var(--bento-success), var(--bento-accent))",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Match status tiles ───────────────────────────────────────── */}
      <div className="bento-panel p-4">
        <div className="bento-label mb-2.5">Match status</div>
        <div className="space-y-2">
          <MatchTile
            tone="success"
            code="M1"
            sub="field + response"
            count={matchCounts.m1_count}
            active={activeMatch === "M1"}
            onClick={() => setActiveMatch(activeMatch === "M1" ? null : "M1")}
          />
          <MatchTile
            tone="warning"
            code="F1"
            sub="field only · chase"
            count={matchCounts.f1_count}
            active={activeMatch === "F1"}
            onClick={() => setActiveMatch(activeMatch === "F1" ? null : "F1")}
          />
          <MatchTile
            tone="magenta"
            code="R1"
            sub="response only"
            count={matchCounts.r1_count}
            active={activeMatch === "R1"}
            onClick={() => setActiveMatch(activeMatch === "R1" ? null : "R1")}
          />
        </div>
        {matchTotal > 0 && (
          <div className="mt-3 flex items-center justify-between text-[10px] text-[var(--bento-ink-3)]">
            <span>M1 rate</span>
            <span className="bento-num font-mono font-semibold text-[var(--bento-ink-2)]">
              {Math.round((matchCounts.m1_count / matchTotal) * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* ── Status filters ───────────────────────────────────────────── */}
      <div className="bento-panel p-4">
        <div className="mb-2.5 flex items-baseline justify-between">
          <span className="bento-label">Status</span>
          <div className="flex items-center gap-2">
            <button
              className="text-[10.5px] font-semibold text-[var(--bento-ink-3)] transition hover:text-[var(--bento-accent)]"
              onClick={() => setActiveStatusIds(new Set())}
            >
              show all
            </button>
            <Link
              href={`/p/${projectId}/settings`}
              className="bento-focus inline-flex h-5 w-5 items-center justify-center rounded-md text-[var(--bento-ink-3)] transition hover:bg-[var(--bento-surface-3)] hover:text-[var(--bento-ink-1)]"
              title="Manage statuses"
            >
              <Settings className="h-3 w-3" strokeWidth={1.8} />
            </Link>
          </div>
        </div>
        <div className="space-y-1.5">
          {statuses.map((s) => {
            const isOn = activeStatusIds.size === 0 || activeStatusIds.has(s.id);
            const isVisible = visibleStatusIds.has(s.id);
            const isSymbOpen = openSymbId === s.id;
            const symbOverride = symbology[s.id];
            const hasSymbOverride =
              !!symbOverride &&
              (symbOverride.size !== undefined ||
                symbOverride.fill_opacity !== undefined ||
                symbOverride.outline_px !== undefined);
            return (
              <div key={s.id} className="space-y-0">
                <div
                  className={`group grid grid-cols-[12px_1fr_auto_22px_22px] items-center gap-2 rounded-[10px] px-2 py-1.5 transition hover:bg-[var(--bento-surface-2)] cursor-pointer ${
                    isOn ? "" : "opacity-45"
                  }`}
                  onClick={() => {
                    const next = new Set(activeStatusIds);
                    if (next.has(s.id)) next.delete(s.id);
                    else next.add(s.id);
                    setActiveStatusIds(next);
                  }}
                >
                  <StatusSymbol color={s.color} icon={s.icon} size={10} />
                  <span className="text-[12px] font-medium text-[var(--bento-ink-1)]">
                    {s.label}
                  </span>
                  <span className="col-start-3 flex flex-col items-end leading-tight">
                    <span className="bento-num font-mono text-[11.5px] font-semibold text-[var(--bento-ink-2)]">
                      {s.count}
                    </span>
                    <span className="bento-num font-mono text-[9px] text-[var(--bento-ink-3)]">
                      {Math.round(s.pct * 100)}%
                    </span>
                  </span>
                  <button
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-md transition ${
                      isVisible
                        ? "text-[var(--bento-accent)]"
                        : "text-[var(--bento-ink-3)]"
                    } hover:bg-[var(--bento-surface-3)] hover:text-[var(--bento-ink-1)]`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = new Set(visibleStatusIds);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      setVisibleStatusIds(next);
                    }}
                    aria-label={isVisible ? "Hide on map" : "Show on map"}
                    title={isVisible ? "Hide on map" : "Show on map"}
                  >
                    {isVisible ? (
                      <Eye className="h-3.5 w-3.5" strokeWidth={1.8} />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" strokeWidth={1.8} />
                    )}
                  </button>
                  {canEditSymbology ? (
                    <button
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-md transition ${
                        isSymbOpen || hasSymbOverride
                          ? "text-[var(--bento-magenta)]"
                          : "text-[var(--bento-ink-3)]"
                      } hover:bg-[var(--bento-surface-3)] hover:text-[var(--bento-ink-1)]`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenSymbId(isSymbOpen ? null : s.id);
                      }}
                      aria-label={isSymbOpen ? "Hide symbology" : "Edit symbology"}
                      title={isSymbOpen ? "Hide symbology" : "Edit symbology"}
                    >
                      {isSymbOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
                      ) : (
                        <Sliders className="h-3 w-3" strokeWidth={1.8} />
                      )}
                    </button>
                  ) : (
                    <span />
                  )}
                  <div
                    className="col-span-3 col-start-2 mt-0.5 h-[3px] overflow-hidden rounded-full"
                    style={{ background: "var(--bento-rule)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round(s.pct * 100)}%`,
                        background: s.color,
                      }}
                    />
                  </div>
                </div>
                {isSymbOpen && canEditSymbology && (
                  <div onClick={(e) => e.stopPropagation()} className="px-2">
                    <SymbologyEditor
                      projectId={projectId}
                      statusId={s.id}
                      initial={symbOverride}
                      onLocalChange={(next) => {
                        if (!setSymbology) return;
                        const merged: SymbologyMap = { ...symbology };
                        // Empty object means "clear all" — drop the key so the
                        // map renderer falls back to global defaults.
                        if (
                          next.size === undefined &&
                          next.fill_opacity === undefined &&
                          next.outline_px === undefined
                        ) {
                          delete merged[s.id];
                        } else {
                          merged[s.id] = next;
                        }
                        setSymbology(merged);
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {canEditSymbology && Object.keys(symbology).length > 0 && (
          <div className="mt-2 flex items-center justify-end">
            <button
              onClick={async () => {
                if (!setSymbology) return;
                setSymbology({});
                try {
                  await fetch(`/api/projects/${projectId}/symbology`, { method: "DELETE" });
                } catch {
                  /* leave UI optimistic; user can retry */
                }
              }}
              className="text-[10.5px] font-semibold text-[var(--bento-ink-3)] transition hover:text-[var(--bento-danger)]"
            >
              Reset all symbology
            </button>
          </div>
        )}
      </div>

      {/* ── Layers ───────────────────────────────────────────────────── */}
      <div className="bento-panel p-4">
        <div className="bento-label mb-2.5">Layers</div>
        <div className="flex flex-wrap gap-1.5">
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
                className={`bento-chip ${isOn ? "bento-chip-active" : ""}`}
              >
                <Icon className="h-3 w-3" strokeWidth={1.8} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Date range ───────────────────────────────────────────────── */}
      <div className="bento-panel p-4">
        <div className="bento-label mb-2.5">Date range</div>
        <div className="bento-seg w-full">
          {(["today", "7d", "30d", "all"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDateRange(d)}
              className={`flex-1 ${dateRange === d ? "bento-seg-on" : ""}`}
            >
              {d === "today" ? "Today" : d === "all" ? "All" : d}
            </button>
          ))}
        </div>
      </div>

      {/* ── Saved views footer (M7 — Analyses Catalog switcher) ──────── */}
      <div className="bento-panel mt-auto p-3">
        <div className="mb-2 flex items-center gap-2">
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-[8px]"
            style={{ background: "var(--bento-magenta-soft)", color: "var(--bento-magenta)" }}
          >
            <Bookmark className="h-3 w-3" strokeWidth={2} />
          </span>
          <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--bento-ink-3)]">
            Saved views
          </span>
        </div>
        {savedViews.length === 0 ? (
          <div className="text-[11px] text-[var(--bento-ink-3)]">
            No views yet — admin curates them from the Catalog drawer.
          </div>
        ) : (
          <div className="space-y-1">
            {savedViews.map((v) => {
              const active = v.id === activeViewId;
              return (
                <button
                  key={v.id}
                  onClick={() => onSwitchView?.(v.id)}
                  className={`bento-focus flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12px] transition ${
                    active
                      ? "bg-[var(--bento-ink-1)] text-[var(--bento-bg)]"
                      : "text-[var(--bento-ink-2)] hover:bg-[var(--bento-surface-2)]"
                  }`}
                  title={v.description ?? undefined}
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${active ? "bg-[var(--bento-bg)]" : "bg-[var(--bento-ink-3)]"}`}
                  />
                  <span className="flex-1 truncate font-semibold">{v.name}</span>
                  {v.role_gate === "admin" && (
                    <span className={`font-mono text-[8.5px] ${active ? "text-[var(--bento-bg)]" : "text-[var(--bento-ink-3)]"}`}>
                      🔒
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Match status tile ───────────────────────────────────────────────────────
function MatchTile({
  tone,
  code,
  sub,
  count,
  active,
  onClick,
}: {
  tone: "success" | "warning" | "magenta";
  code: string;
  sub: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const tileClass =
    tone === "success"
      ? "bento-tile-success"
      : tone === "warning"
        ? "bento-tile-warning"
        : "bento-tile-magenta";
  const accentVar =
    tone === "success"
      ? "var(--bento-success)"
      : tone === "warning"
        ? "var(--bento-warning)"
        : "var(--bento-magenta)";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`bento-focus w-full ${tileClass} px-3 py-2.5 text-left transition ${
        active
          ? "ring-2 ring-offset-1 ring-offset-[var(--bento-surface)]"
          : "hover:brightness-105"
      }`}
      style={
        active
          ? ({
              ["--tw-ring-color" as string]: accentVar,
            } as React.CSSProperties)
          : undefined
      }
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="bento-pin" style={{ background: accentVar }} />
          <span className="font-display text-[13px] font-bold" style={{ color: accentVar }}>
            {code}
          </span>
          <span className="text-[10.5px] text-[var(--bento-ink-3)]">{sub}</span>
        </span>
        <span
          className="bento-num font-mono text-[13.5px] font-semibold"
          style={{ color: accentVar }}
        >
          {count}
        </span>
      </div>
    </button>
  );
}

// ── Status symbol renderer ────────────────────────────────────────────────────

export type StatusSymbolType = "circle" | "square" | "diamond" | "triangle" | "star";

export function StatusSymbol({
  color,
  icon,
  size = 10,
}: {
  color: string;
  icon: string | null;
  size?: number;
}) {
  const s = size;
  const sym = (icon ?? "circle") as StatusSymbolType;

  if (sym === "square") {
    return (
      <span
        style={{
          display: "inline-block",
          width: s,
          height: s,
          background: color,
          borderRadius: 3,
          boxShadow: "0 0 0 2px var(--bento-surface)",
        }}
      />
    );
  }
  if (sym === "diamond") {
    return (
      <span
        style={{
          display: "inline-block",
          width: s,
          height: s,
          background: color,
          transform: "rotate(45deg)",
          borderRadius: 2,
          boxShadow: "0 0 0 2px var(--bento-surface)",
        }}
      />
    );
  }
  if (sym === "triangle") {
    return (
      <span
        style={{
          display: "inline-block",
          width: 0,
          height: 0,
          borderLeft: `${s * 0.55}px solid transparent`,
          borderRight: `${s * 0.55}px solid transparent`,
          borderBottom: `${s}px solid ${color}`,
        }}
      />
    );
  }
  if (sym === "star") {
    return (
      <svg width={s} height={s} viewBox="0 0 20 20" style={{ display: "inline-block" }}>
        <polygon
          points="10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7"
          fill={color}
        />
      </svg>
    );
  }
  // default: filled circle with bento halo
  return (
    <span
      style={{
        display: "inline-block",
        width: s,
        height: s,
        background: color,
        borderRadius: "50%",
        boxShadow: "0 0 0 2px var(--bento-surface)",
      }}
    />
  );
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
