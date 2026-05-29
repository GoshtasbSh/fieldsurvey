"use client";

import { useState } from "react";
import {
  Search,
  SlidersHorizontal,
  Upload,
  Plus,
  ZoomIn,
  ZoomOut,
  LocateFixed,
  X,
  Layers,
  Check,
} from "lucide-react";
import type { MatchStatusCounts, MatchStatus } from "@/lib/match/status";
import { BASEMAPS, type BasemapKey } from "@/components/map/maplibre-map";
import { useIsRestored } from "@/components/desktop/history-dropdown";

export function CommandCapsule({
  onAdd,
  onImport,
  canEdit = true,
  canImport = true,
}: {
  onAdd: () => void;
  onImport: () => void;
  canEdit?: boolean;
  canImport?: boolean;
}) {
  // Snapshot view is read-only by definition — block mutations.
  const restored = useIsRestored();
  const writeOk = canEdit && !restored;
  const importOk = canImport && !restored;
  return (
    <div
      className="absolute left-1/2 top-[18px] z-30 flex min-w-[460px] max-w-[640px] -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--bento-rule)] bg-[var(--shell-base-alpha-86)] py-[7px] pl-[14px] pr-[7px] backdrop-blur-[24px] backdrop-saturate-[150%]"
      style={{ boxShadow: "var(--bento-shadow-md)" }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5 text-[12.5px] text-[var(--bento-ink-3)]">
        <Search className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.8} />
        <input
          placeholder="Search points, responses, surveyors, addresses…"
          className="min-w-0 flex-1 bg-transparent font-medium text-[var(--bento-ink-1)] outline-none placeholder:text-[var(--bento-ink-3)]"
        />
        <kbd className="rounded border border-[var(--bento-rule)] bg-[var(--bento-surface-2)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--bento-ink-2)]">
          ⌘ K
        </kbd>
      </div>
      <span className="h-4 w-px bg-[var(--bento-rule)]" />
      <button
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-display text-[11px] font-bold text-[var(--bento-ink-2)] transition hover:bg-[var(--bento-surface-2)] hover:text-[var(--bento-ink-1)]"
      >
        <SlidersHorizontal className="h-3 w-3" strokeWidth={1.8} />
        Filters
      </button>
      {importOk && (
        <button
          onClick={onImport}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-display text-[11px] font-bold text-[var(--bento-ink-2)] transition hover:bg-[var(--bento-surface-2)] hover:text-[var(--bento-ink-1)]"
        >
          <Upload className="h-3 w-3" strokeWidth={1.8} />
          Import
        </button>
      )}
      {writeOk ? (
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-display text-[11px] font-bold transition hover:-translate-y-px"
          style={{
            background: "var(--bento-accent)",
            color: "var(--bento-on-accent)",
            boxShadow: "var(--bento-shadow-accent)",
          }}
        >
          <Plus className="h-3 w-3" strokeWidth={2.2} />
          Add point
        </button>
      ) : (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-display text-[11px] font-bold"
          style={{
            background: "var(--bento-surface-2)",
            color: "var(--bento-ink-3)",
            border: "1px solid var(--bento-rule)",
          }}
          title={restored ? "Viewing a snapshot — read-only" : "Read-only access"}
        >
          {restored ? "Snapshot" : "Read-only"}
        </span>
      )}
    </div>
  );
}

export function ActiveFiltersStrip({
  activeMatch,
  activeStatuses,
  onClearMatch,
  onClearStatus,
  onClearAll,
}: {
  activeMatch: MatchStatus | null;
  activeStatuses: Array<{ id: string; label: string; color: string }>;
  onClearMatch: () => void;
  onClearStatus: (id: string) => void;
  onClearAll: () => void;
}) {
  const hasAny = activeMatch || activeStatuses.length > 0;
  if (!hasAny) return null;

  return (
    <div
      className="absolute left-1/2 top-[62px] z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--bento-rule)] bg-[var(--shell-base-alpha-86)] py-1 pl-3 pr-1.5 text-[11px] text-[var(--bento-ink-3)] backdrop-blur-[18px]"
      style={{ boxShadow: "var(--bento-shadow-sm)" }}
    >
      <span className="font-semibold">Filtering:</span>
      {activeMatch && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{
            background: "var(--bento-accent-soft)",
            color: "var(--bento-accent)",
            border: "1px solid transparent",
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {activeMatch}
          <button
            onClick={onClearMatch}
            className="text-[var(--bento-ink-3)] transition hover:text-[var(--bento-ink-1)]"
          >
            ✕
          </button>
        </span>
      )}
      {activeStatuses.map((s) => (
        <span
          key={s.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bento-rule)] bg-[var(--bento-surface-2)] px-2 py-0.5 text-[11px] font-semibold text-[var(--bento-ink-2)]"
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
          {s.label}
          <button
            onClick={() => onClearStatus(s.id)}
            className="text-[var(--bento-ink-3)] transition hover:text-[var(--bento-ink-1)]"
          >
            ✕
          </button>
        </span>
      ))}
      <button
        onClick={onClearAll}
        className="px-1 text-[11px] font-semibold transition"
        style={{ color: "var(--bento-danger)" }}
      >
        Clear all
      </button>
    </div>
  );
}

export function MapLegend({ counts }: { counts: MatchStatusCounts }) {
  return (
    <div
      className="absolute bottom-[18px] left-[18px] z-20 min-w-[220px] rounded-[16px] border border-[var(--bento-rule)] bg-[var(--shell-base-alpha-86)] p-3.5 backdrop-blur-[20px] backdrop-saturate-[150%]"
      style={{ boxShadow: "var(--bento-shadow-md)" }}
    >
      <h5 className="bento-label mb-2">Match status</h5>
      <Row
        dot={{ background: "var(--bento-success)" }}
        label="Matched"
        n={counts.m1_count}
        numColor="var(--bento-success)"
      />
      <Row
        dot={{ background: "var(--bento-warning)" }}
        label="Field only"
        n={counts.f1_count}
        numColor="var(--bento-warning)"
      />
      <Row
        dot={{ background: "var(--bento-magenta)", borderRadius: "3px" }}
        label="Response only"
        n={counts.r1_count}
        numColor="var(--bento-magenta)"
        rounded
      />
    </div>
  );
}

function Row({
  dot,
  label,
  n,
  numColor,
  rounded,
}: {
  dot: React.CSSProperties;
  label: string;
  n: number;
  numColor: string;
  rounded?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 py-0.5 text-[11px] text-[var(--bento-ink-2)]">
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
        <span
          className="block h-[8px] w-[8px]"
          style={{
            ...dot,
            borderRadius: rounded ? "2px" : "9999px",
            boxShadow: "0 0 0 2px var(--bento-surface)",
          }}
        />
      </span>
      <span className="flex-1 font-medium">{label}</span>
      <span
        className="bento-num font-mono text-[11.5px] font-semibold"
        style={{ color: numColor }}
      >
        {n}
      </span>
    </div>
  );
}

export function MapControls({
  onZoomIn,
  onZoomOut,
  onLocate,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onLocate: () => void;
}) {
  return (
    <div className="absolute bottom-[110px] right-[20px] z-15 flex flex-col gap-1.5">
      <Ctl onClick={onZoomIn}>
        <ZoomIn className="h-4 w-4" strokeWidth={1.8} />
      </Ctl>
      <Ctl onClick={onZoomOut}>
        <ZoomOut className="h-4 w-4" strokeWidth={1.8} />
      </Ctl>
      <Ctl onClick={onLocate}>
        <LocateFixed className="h-4 w-4" strokeWidth={1.8} />
      </Ctl>
    </div>
  );
}

function Ctl({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="bento-focus inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--bento-rule)] bg-[var(--shell-base-alpha-86)] text-[var(--bento-ink-2)] backdrop-blur-[16px] transition hover:text-[var(--bento-accent)]"
      style={{ boxShadow: "var(--bento-shadow-sm)" }}
    >
      {children}
    </button>
  );
}

export function AddFab({ onClick, active }: { onClick: () => void; active?: boolean }) {
  // Hide entirely in snapshot view.
  const restored = useIsRestored();
  if (restored) return null;
  const palette = active
    ? { bg: "var(--bento-danger)", fg: "white" }
    : { bg: "var(--bento-accent)", fg: "var(--bento-on-accent)" };
  return (
    <button
      onClick={onClick}
      aria-label={active ? "Cancel placing point" : "Add point"}
      className="absolute bottom-[22px] right-[22px] z-20 inline-flex h-14 w-14 items-center justify-center rounded-full transition hover:-translate-y-0.5 hover:scale-[1.04]"
      style={{
        background: palette.bg,
        color: palette.fg,
        boxShadow: `0 14px 28px -8px ${
          active
            ? "oklch(62% 0.18 25 / 0.55)"
            : "oklch(70% 0.14 230 / 0.45)"
        }, var(--bento-shadow-accent)`,
      }}
    >
      {active ? <X className="h-6 w-6" strokeWidth={2.5} /> : <Plus className="h-6 w-6" strokeWidth={2.5} />}
    </button>
  );
}

export function BasemapSwitcher({
  value,
  onChange,
}: {
  value: BasemapKey;
  onChange: (k: BasemapKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = BASEMAPS[value];
  return (
    <div className="absolute bottom-[18px] right-[140px] z-20">
      {open && (
        <div
          className="absolute bottom-12 right-0 mb-1 w-[220px] overflow-hidden rounded-[14px] border border-[var(--bento-rule)] bg-[var(--shell-1-alpha-95)] p-1.5 backdrop-blur-[20px]"
          style={{ boxShadow: "var(--bento-shadow-lg)" }}
        >
          {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) => {
            const m = BASEMAPS[k];
            const on = k === value;
            return (
              <button
                key={k}
                onClick={() => {
                  onChange(k);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition ${
                  on
                    ? "text-[var(--bento-ink-1)]"
                    : "text-[var(--bento-ink-2)] hover:bg-[var(--bento-surface-2)]"
                }`}
                style={
                  on ? { background: "var(--bento-accent-soft)" } : undefined
                }
              >
                <span
                  className="flex h-4 w-4 items-center justify-center"
                  style={{ color: "var(--bento-accent)" }}
                >
                  {on && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="font-display text-[12px] font-bold">{m.label}</span>
                  <span className="text-[10px] text-[var(--bento-ink-3)]">{m.subtitle}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Choose basemap"
        className="bento-focus inline-flex items-center gap-2 rounded-[12px] border border-[var(--bento-rule)] bg-[var(--shell-base-alpha-86)] px-3 py-2 font-display text-[11px] font-bold text-[var(--bento-ink-2)] backdrop-blur-[16px] transition hover:text-[var(--bento-accent)]"
        style={{ boxShadow: "var(--bento-shadow-sm)" }}
      >
        <Layers className="h-4 w-4" strokeWidth={1.8} />
        {current.label}
      </button>
    </div>
  );
}

export function PlaceHintBanner({ visible, onCancel }: { visible: boolean; onCancel: () => void }) {
  if (!visible) return null;
  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-[70px] z-30 inline-flex -translate-x-1/2 items-center gap-3 rounded-full border bg-[var(--shell-base-alpha-86)] py-2 pl-4 pr-2 text-[12.5px] font-semibold text-[var(--bento-ink-1)] backdrop-blur-[18px]"
      style={{
        borderColor: "var(--bento-accent)",
        boxShadow: "var(--bento-shadow-md)",
      }}
    >
      <span
        className="inline-flex h-2 w-2 rounded-full"
        style={{
          background: "var(--bento-accent)",
          boxShadow: "0 0 10px var(--bento-accent-glow)",
        }}
      />
      Click on the map to place your point
      <button
        onClick={onCancel}
        className="ml-1 inline-flex items-center gap-1 rounded-full bg-[var(--bento-surface-2)] px-2.5 py-1 text-[11px] font-bold text-[var(--bento-ink-2)] transition hover:bg-[var(--bento-surface-3)] hover:text-[var(--bento-ink-1)]"
      >
        <X className="h-3 w-3" strokeWidth={2} />
        Cancel
      </button>
    </div>
  );
}

export function SyncPill({ lastSyncSeconds, refId }: { lastSyncSeconds: number; refId?: string }) {
  return (
    <div
      className="absolute bottom-[18px] right-[88px] z-15 inline-flex items-center gap-2 rounded-full border border-[var(--bento-rule)] bg-[var(--shell-base-alpha-86)] px-3 py-1 font-mono text-[10px] text-[var(--bento-ink-3)] backdrop-blur-[14px]"
      style={{ boxShadow: "var(--bento-shadow-xs)" }}
    >
      <span className="relative h-1.5 w-1.5 rounded-full" style={{ background: "var(--bento-success)" }}>
        <span
          className="absolute inset-0 animate-ping rounded-full"
          style={{ background: "var(--bento-success)", opacity: 0.55 }}
        />
      </span>
      Last sync {lastSyncSeconds}s
      {refId && (
        <span style={{ color: "var(--bento-accent)" }}>· #{refId}</span>
      )}
    </div>
  );
}

export { X };
