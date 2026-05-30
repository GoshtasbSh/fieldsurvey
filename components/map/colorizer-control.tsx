"use client";

import { useEffect, useMemo, useState } from "react";
import { Palette, ChevronDown, X, Search } from "lucide-react";
import type { ColorizeSpec, ColumnProfile, ClassificationMethod, ColorRamp } from "@/lib/analyses/types";
import { continuousRampStops, categoricalColors, defaultRampFor, MISSING_COLOR } from "@/lib/colorize/palettes";
import { defaultSpecFor, resolveBreaks } from "@/lib/colorize/auto-classify";

type Props = {
  profiles: ColumnProfile[];
  /** Numeric values of the currently-selected column (for break preview). */
  selectedValues: number[];
  spec: ColorizeSpec | null;
  onChange: (spec: ColorizeSpec | null) => void;
};

const N_MIN_COLORIZE = 10;

const CLASSIFICATION_LABELS: Record<ClassificationMethod, string> = {
  quantile: "Quantile (equal counts)",
  equal_interval: "Equal interval",
  natural_breaks: "Natural breaks (Jenks)",
  manual: "Manual",
};

const CONTINUOUS_RAMPS: ColorRamp[] = ["viridis", "inferno", "plasma", "cividis", "magma"];
const DIVERGING_RAMPS: ColorRamp[] = ["RdBu_r", "BrBG"];
const CATEGORICAL_RAMPS: ColorRamp[] = ["Set2", "Set3", "Dark2"];

export function ColorizerControl({ profiles, selectedValues, spec, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () => profiles.filter((p) => p.key.toLowerCase().includes(search.toLowerCase())),
    [profiles, search],
  );

  const currentProfile = spec
    ? profiles.find((p) => p.key === spec.columnKey)
    : null;

  const isNumeric = spec?.inferredType === "numeric_continuous" || spec?.inferredType === "numeric_skewed";
  const isLikert = spec?.inferredType === "likert";
  const isCategorical = spec?.inferredType === "categorical" || spec?.inferredType === "boolean";

  const rampOptions = isNumeric
    ? CONTINUOUS_RAMPS
    : isLikert
    ? DIVERGING_RAMPS
    : isCategorical
    ? CATEGORICAL_RAMPS
    : CONTINUOUS_RAMPS;

  // Live break preview for numeric
  const breaks = useMemo(() => {
    if (!isNumeric || !spec) return [];
    return resolveBreaks(selectedValues, spec.classification, spec.classCount, spec.manualBreaks);
  }, [isNumeric, spec, selectedValues]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--shell-border)] bg-[var(--shell-base-alpha-85)] px-3 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.07em] text-[var(--shell-text-2)] backdrop-blur-md transition-colors hover:bg-[var(--shell-2)]"
        title="Color points by a survey response"
      >
        <Palette className="h-3 w-3" strokeWidth={1.7} />
        <span>
          {spec ? <>Color: {spec.columnKey.slice(0, 18)}</> : "Color by ▾"}
        </span>
        {spec && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-[var(--shell-3)]"
            aria-label="Clear colorizer"
          >
            <X className="h-2.5 w-2.5" strokeWidth={2.2} />
          </span>
        )}
        <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={1.7} />
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-2 w-[340px] rounded-2xl border border-[var(--shell-border)] bg-[var(--shell-base-alpha-95)] p-3 shadow-xl backdrop-blur-xl">
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] px-2">
            <Search className="h-3 w-3 text-[var(--shell-text-muted)]" strokeWidth={1.7} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a column…"
              className="w-full bg-transparent py-1.5 text-[12px] outline-none"
            />
          </div>

          <div className="mb-3 max-h-[180px] overflow-y-auto">
            <ColumnRow
              label="Match status (default)"
              meta="M1 / F1 / R1 — the project KPI"
              selected={!spec}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            />
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-[11.5px] text-[var(--shell-text-muted)]">
                No columns yet. Import survey responses to enable.
              </div>
            ) : (
              filtered.map((p) => {
                const eligible = p.nNonNull >= N_MIN_COLORIZE && p.inferredType !== "text_open";
                return (
                  <ColumnRow
                    key={p.key}
                    label={p.key}
                    meta={`${p.inferredType} · n=${p.nNonNull} · ${p.distinct} distinct`}
                    selected={spec?.columnKey === p.key}
                    disabled={!eligible}
                    disabledReason={
                      p.inferredType === "text_open"
                        ? "open text — try a different column"
                        : `need ${N_MIN_COLORIZE} non-empty responses, you have ${p.nNonNull}`
                    }
                    onClick={() => {
                      if (!eligible) return;
                      onChange(defaultSpecFor(p));
                    }}
                  />
                );
              })
            )}
          </div>

          {spec && currentProfile && (
            <div className="space-y-3 border-t border-[var(--shell-border)] pt-3">
              {/* Ramp picker */}
              <div>
                <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.07em] text-[var(--shell-text-muted)]">
                  Ramp
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {rampOptions.map((r) => (
                    <button
                      key={r}
                      onClick={() => onChange({ ...spec, ramp: r })}
                      className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[10.5px] transition-colors ${
                        spec.ramp === r
                          ? "border-[var(--shell-text-muted)] bg-[var(--shell-2)]"
                          : "border-[var(--shell-border)] hover:bg-[var(--shell-2)]"
                      }`}
                    >
                      <RampSwatch ramp={r} isCategorical={isCategorical} />
                      <span className="font-mono">{r}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Numeric controls */}
              {isNumeric && (
                <>
                  <div>
                    <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.07em] text-[var(--shell-text-muted)]">
                      Classification
                    </div>
                    <select
                      value={spec.classification}
                      onChange={(e) => onChange({ ...spec, classification: e.target.value as ClassificationMethod })}
                      className="w-full rounded-md border border-[var(--shell-border)] bg-[var(--shell-2)] px-2 py-1 text-[11.5px]"
                    >
                      {(["quantile", "equal_interval", "natural_breaks", "manual"] as ClassificationMethod[]).map((m) => (
                        <option key={m} value={m}>{CLASSIFICATION_LABELS[m]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.07em] text-[var(--shell-text-muted)]">
                      Classes
                    </div>
                    <div className="flex gap-1.5">
                      {[3, 5, 7, 9].map((k) => (
                        <button
                          key={k}
                          onClick={() => onChange({ ...spec, classCount: k as 3 | 5 | 7 | 9 })}
                          className={`rounded-md border px-3 py-1 font-mono text-[11px] transition-colors ${
                            spec.classCount === k
                              ? "border-[var(--shell-text-muted)] bg-[var(--shell-2)]"
                              : "border-[var(--shell-border)] hover:bg-[var(--shell-2)]"
                          }`}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                  {breaks.length > 0 && (
                    <div>
                      <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.07em] text-[var(--shell-text-muted)]">
                        Breaks
                      </div>
                      <div className="space-y-0.5">
                        {breaks.map((b, i) => (
                          <div key={i} className="flex items-center justify-between text-[10.5px]">
                            <span className="font-mono text-[var(--shell-text-muted)]">≤</span>
                            <span className="font-mono tabular-nums">{b.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Legend preview */}
              <Legend spec={spec} profile={currentProfile} breaks={breaks} />

              {/* Reverse + missing chip */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={!!spec.reversed}
                    onChange={(e) => onChange({ ...spec, reversed: e.target.checked })}
                  />
                  Reverse
                </label>
                <span className="font-mono text-[10px] text-[var(--shell-text-muted)]">
                  missing: {currentProfile ? `${Math.round((1 - currentProfile.nNonNull / Math.max(1, currentProfile.nNonNull + 1)) * 100)}%` : "?"}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ColumnRow({
  label, meta, selected, disabled, disabledReason, onClick,
}: { label: string; meta: string; selected?: boolean; disabled?: boolean; disabledReason?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
        selected ? "bg-[var(--shell-2)]" : "hover:bg-[var(--shell-2)]"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      title={disabled ? disabledReason : undefined}
    >
      <div className="min-w-0">
        <div className="truncate text-[12px] font-semibold text-[var(--shell-text)]">{label}</div>
        <div className="truncate text-[10px] text-[var(--shell-text-muted)]">{meta}</div>
      </div>
      {selected && <span className="font-mono text-[10px] text-[var(--shell-text-muted)]">●</span>}
    </button>
  );
}

function RampSwatch({ ramp, isCategorical }: { ramp: ColorRamp; isCategorical: boolean }) {
  const stops = isCategorical ? categoricalColors(ramp, 5) : continuousRampStops(ramp, 5);
  return (
    <span className="inline-flex h-3 overflow-hidden rounded-sm">
      {stops.map((c, i) => (
        <span key={i} style={{ width: 8, background: c }} />
      ))}
    </span>
  );
}

function Legend({
  spec, profile, breaks,
}: { spec: ColorizeSpec; profile: ColumnProfile; breaks: number[] }) {
  const isNumeric = spec.inferredType === "numeric_continuous" || spec.inferredType === "numeric_skewed";
  const isLikert = spec.inferredType === "likert";
  const isCategorical = spec.inferredType === "categorical" || spec.inferredType === "boolean";
  const k = spec.classCount;

  if (isNumeric) {
    const colors = continuousRampStops(spec.ramp, k, spec.reversed);
    return (
      <div>
        <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.07em] text-[var(--shell-text-muted)]">Legend</div>
        <div className="flex h-3 overflow-hidden rounded-sm">
          {colors.map((c, i) => (
            <span key={i} style={{ flex: 1, background: c }} />
          ))}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[9.5px] text-[var(--shell-text-muted)]">
          <span>{profile.min?.toFixed(1) ?? "min"}</span>
          {breaks[Math.floor(breaks.length / 2)] != null && (
            <span>{breaks[Math.floor(breaks.length / 2)]!.toFixed(1)}</span>
          )}
          <span>{profile.max?.toFixed(1) ?? "max"}</span>
        </div>
      </div>
    );
  }

  if (isLikert && profile.likertOrder) {
    const colors = continuousRampStops(spec.ramp, profile.likertOrder.length, spec.reversed);
    return (
      <div>
        <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.07em] text-[var(--shell-text-muted)]">Legend</div>
        <div className="space-y-0.5">
          {profile.likertOrder.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[i] }} />
              <span className="truncate text-[10.5px]">{label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isCategorical) {
    const colors = categoricalColors(spec.ramp, profile.sampleValues.length);
    return (
      <div>
        <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.07em] text-[var(--shell-text-muted)]">Legend</div>
        <div className="space-y-0.5">
          {profile.sampleValues.slice(0, 8).map((v, i) => (
            <div key={v} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[i] }} />
              <span className="truncate text-[10.5px]">{v}</span>
            </div>
          ))}
          {profile.sampleValues.length > 8 && (
            <div className="text-[9.5px] text-[var(--shell-text-muted)]">+ {profile.sampleValues.length - 8} more</div>
          )}
          <div className="mt-1.5 flex items-center gap-2 border-t border-[var(--shell-border)] pt-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: MISSING_COLOR }} />
            <span className="text-[10.5px] text-[var(--shell-text-muted)]">missing / F1</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
