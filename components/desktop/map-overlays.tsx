"use client";

import { useState } from "react";
import { Search, SlidersHorizontal, Upload, Plus, ZoomIn, ZoomOut, LocateFixed, X, Layers, Check } from "lucide-react";
import type { MatchStatusCounts, MatchStatus } from "@/lib/match/status";
import { BASEMAPS, type BasemapKey } from "@/components/map/maplibre-map";

export function CommandCapsule({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  return (
    <div className="absolute left-1/2 top-[18px] z-30 flex min-w-[460px] max-w-[640px] -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--shell-border-soft)] bg-[var(--shell-base-alpha-78)] py-[7px] pl-[14px] pr-[7px] shadow-[0_14px_36px_-12px_oklch(0%_0_0/0.55),inset_0_1px_0_oklch(100%_0_0/0.1)] backdrop-blur-[28px] backdrop-saturate-[180%]">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 text-[12.5px] text-[var(--shell-text-muted)]">
        <Search className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.7} />
        <input
          placeholder="Search points, responses, surveyors, addresses…"
          className="min-w-0 flex-1 bg-transparent font-medium text-[var(--shell-text)] outline-none placeholder:text-[var(--shell-text-muted)]"
        />
        <kbd className="rounded border border-[var(--shell-border-soft)] bg-[var(--shell-2)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--shell-text-2)]">⌘ K</kbd>
      </div>
      <span className="h-4 w-px bg-[var(--shell-border-soft)]" />
      <button className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-display text-[11px] font-bold text-[var(--shell-text-2)] hover:bg-[var(--shell-2)] hover:text-[var(--shell-text)] transition">
        <SlidersHorizontal className="h-3 w-3" strokeWidth={1.7} />
        Filters
      </button>
      <button
        onClick={onImport}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-display text-[11px] font-bold text-[var(--shell-text-2)] hover:bg-[var(--shell-2)] hover:text-[var(--shell-text)] transition"
      >
        <Upload className="h-3 w-3" strokeWidth={1.7} />
        Import
      </button>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-1.5 rounded-full bg-[oklch(78%_0.155_234)] px-3.5 py-1.5 font-display text-[11px] font-bold text-[var(--shell-base)] shadow-[0_2px_10px_oklch(78%_0.155_234/0.35),inset_0_1px_0_oklch(100%_0_0/0.3)] hover:bg-[oklch(82%_0.16_234)] hover:-translate-y-px transition"
      >
        <Plus className="h-3 w-3" strokeWidth={2} />
        Add point
      </button>
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
    <div className="absolute left-1/2 top-[62px] z-25 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--shell-border)] bg-[var(--shell-base-alpha-65)] py-1 pl-3 pr-1.5 text-[11px] text-[var(--shell-text-muted)] backdrop-blur-[18px]">
      <span className="font-semibold">Filtering:</span>
      {activeMatch && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[oklch(78%_0.155_234/0.3)] bg-[oklch(78%_0.155_234/0.16)] px-2 py-0.5 text-[11px] font-semibold text-[oklch(78%_0.155_234)]">
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {activeMatch}
          <button onClick={onClearMatch} className="text-[var(--shell-text-muted)] hover:text-[var(--shell-text)]">✕</button>
        </span>
      )}
      {activeStatuses.map((s) => (
        <span
          key={s.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--shell-border)] bg-[var(--shell-2)] px-2 py-0.5 text-[11px] font-semibold text-[var(--shell-text-2)]"
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
          {s.label}
          <button onClick={() => onClearStatus(s.id)} className="text-[var(--shell-text-muted)] hover:text-[var(--shell-text)]">✕</button>
        </span>
      ))}
      <button onClick={onClearAll} className="px-1 text-[11px] font-semibold text-[var(--shell-text-muted)] hover:text-[oklch(68%_0.21_25)]">
        Clear all
      </button>
    </div>
  );
}

export function MapLegend({ counts }: { counts: MatchStatusCounts }) {
  return (
    <div className="absolute bottom-[18px] left-[18px] z-20 min-w-[220px] rounded-xl border border-[var(--shell-border)] bg-[var(--shell-base-alpha-86)] p-3.5 shadow-[0_10px_30px_-12px_oklch(0%_0_0/0.55)] backdrop-blur-[20px] backdrop-saturate-[160%]">
      <h5 className="mb-2 flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-[var(--shell-text-muted)] before:h-[3px] before:w-[3px] before:rounded-full before:bg-[oklch(78%_0.155_234)] before:shadow-[0_0_5px_oklch(78%_0.155_234/0.35)]">
        Match Status
      </h5>
      <Row dot="bg-[oklch(76%_0.16_158)]" ring="ring-2 ring-white" label="Matched" n={counts.m1_count} numClass="text-[var(--shell-text)]" />
      <Row dot="bg-[oklch(78%_0.165_70)]" ring="ring-[2.5px] ring-[#fde047]" label="Field only" n={counts.f1_count} numClass="text-[oklch(82%_0.17_86)]" />
      <Row dot="bg-[oklch(72%_0.18_305)] rounded-[3px]" ring="ring-[2.5px] ring-[#a855f7]" label="Response only" n={counts.r1_count} numClass="text-[oklch(72%_0.18_305)]" rounded />
    </div>
  );
}

function Row({ dot, ring, label, n, numClass, rounded }: { dot: string; ring: string; label: string; n: number; numClass: string; rounded?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 py-0.5 text-[11px] text-[var(--shell-text-2)]">
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
        <span className={`block h-[7px] w-[7px] ${dot} ${ring}`} style={{ borderRadius: rounded ? "2px" : "9999px" }} />
      </span>
      <span className="flex-1 font-semibold">{label}</span>
      <span className={`font-mono text-[11px] font-semibold tabular-nums ${numClass}`}>{n}</span>
    </div>
  );
}

export function MapControls({ onZoomIn, onZoomOut, onLocate }: { onZoomIn: () => void; onZoomOut: () => void; onLocate: () => void }) {
  return (
    <div className="absolute bottom-[110px] right-[20px] z-15 flex flex-col gap-1.5">
      <Ctl onClick={onZoomIn}><ZoomIn className="h-4 w-4" strokeWidth={1.7} /></Ctl>
      <Ctl onClick={onZoomOut}><ZoomOut className="h-4 w-4" strokeWidth={1.7} /></Ctl>
      <Ctl onClick={onLocate}><LocateFixed className="h-4 w-4" strokeWidth={1.7} /></Ctl>
    </div>
  );
}

function Ctl({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--shell-border)] bg-[var(--shell-base-alpha-78)] text-[var(--shell-text-2)] hover:border-[oklch(78%_0.155_234/0.4)] hover:text-[oklch(78%_0.155_234)] transition backdrop-blur-[16px]"
    >
      {children}
    </button>
  );
}

export function AddFab({ onClick, active }: { onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={active ? "Cancel placing point" : "Add point"}
      className={
        active
          ? "absolute bottom-[22px] right-[22px] z-20 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[oklch(68%_0.21_25)] text-white shadow-[0_14px_32px_-8px_oklch(68%_0.21_25/0.6),0_0_0_6px_oklch(68%_0.21_25/0.12),inset_0_1px_0_oklch(100%_0_0/0.35)] transition hover:-translate-y-0.5 hover:scale-[1.04]"
          : "absolute bottom-[22px] right-[22px] z-20 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[oklch(78%_0.155_234)] text-[var(--shell-base)] shadow-[0_14px_32px_-8px_oklch(78%_0.155_234/0.6),0_0_0_6px_oklch(78%_0.155_234/0.12),inset_0_1px_0_oklch(100%_0_0/0.35)] transition hover:-translate-y-0.5 hover:scale-[1.04]"
      }
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
        <div className="absolute bottom-12 right-0 mb-1 w-[210px] overflow-hidden rounded-xl border border-[var(--shell-border)] bg-[var(--shell-1-alpha-95)] p-1.5 shadow-[0_18px_40px_-12px_oklch(0%_0_0/0.6)] backdrop-blur-[20px]">
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
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                  on
                    ? "bg-[oklch(78%_0.155_234/0.16)] text-[var(--shell-text)]"
                    : "text-[var(--shell-text-2)] hover:bg-[var(--shell-2)]"
                }`}
              >
                <span className="flex h-4 w-4 items-center justify-center text-[oklch(78%_0.155_234)]">
                  {on && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="font-display text-[12px] font-bold">{m.label}</span>
                  <span className="text-[10px] text-[var(--shell-text-muted)]">{m.subtitle}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Choose basemap"
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-base-alpha-86)] px-3 py-2 font-display text-[11px] font-bold text-[var(--shell-text-2)] shadow-[0_10px_28px_-10px_oklch(0%_0_0/0.55)] backdrop-blur-[16px] transition hover:border-[oklch(78%_0.155_234/0.4)] hover:text-[oklch(78%_0.155_234)]"
      >
        <Layers className="h-4 w-4" strokeWidth={1.7} />
        {current.label}
      </button>
    </div>
  );
}

export function PlaceHintBanner({ visible, onCancel }: { visible: boolean; onCancel: () => void }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-[70px] z-30 inline-flex -translate-x-1/2 items-center gap-3 rounded-full border border-[oklch(78%_0.155_234/0.5)] bg-[var(--shell-base-alpha-86)] py-2 pl-4 pr-2 text-[12.5px] font-semibold text-[var(--shell-text)] shadow-[0_14px_36px_-12px_oklch(0%_0_0/0.55)] backdrop-blur-[18px]">
      <span className="inline-flex h-2 w-2 rounded-full bg-[oklch(78%_0.155_234)] shadow-[0_0_10px_oklch(78%_0.155_234/0.7)]" />
      Click on the map to place your point
      <button
        onClick={onCancel}
        className="ml-1 inline-flex items-center gap-1 rounded-full bg-[var(--shell-2)] px-2.5 py-1 text-[11px] font-bold text-[var(--shell-text-2)] hover:bg-[var(--shell-3)] hover:text-[var(--shell-text)] transition"
      >
        <X className="h-3 w-3" strokeWidth={2} />
        Cancel
      </button>
    </div>
  );
}

export function SyncPill({ lastSyncSeconds, refId }: { lastSyncSeconds: number; refId?: string }) {
  return (
    <div className="absolute bottom-[18px] right-[88px] z-15 inline-flex items-center gap-2 rounded-full border border-[var(--shell-border)] bg-[var(--shell-base-alpha-78)] px-3 py-1 font-mono text-[10px] text-[var(--shell-text-muted)] backdrop-blur-[14px]">
      <span className="relative h-1.5 w-1.5 rounded-full bg-[oklch(76%_0.16_158)] after:absolute after:inset-0 after:animate-ping after:rounded-full after:bg-[oklch(76%_0.16_158/0.55)]" />
      Last sync {lastSyncSeconds}s {refId ? <span className="text-[oklch(78%_0.155_234)]">· #{refId}</span> : null}
    </div>
  );
}

export { X };
