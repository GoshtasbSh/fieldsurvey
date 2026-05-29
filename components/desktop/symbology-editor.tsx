"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Loader2, Check } from "lucide-react";

export type SymbologyOverride = {
  size?: number;
  fill_opacity?: number;
  outline_px?: number;
};
export type SymbologyMap = Record<string, SymbologyOverride>;

export const SYMBOLOGY_DEFAULTS = { size: 8, fill_opacity: 0.85, outline_px: 1.5 };

const SAVE_DEBOUNCE_MS = 400;

/**
 * Per-status size / fill-opacity / outline sliders shown inside an expanded
 * status row. Patches `project_settings.symbology_overrides` via the
 * /api/projects/:projectId/symbology endpoint, debouncing 400 ms so dragging
 * the slider doesn't spam the server. The parent passes `onLocalChange`
 * so the map can re-paint immediately while the network request is in-flight.
 *
 * Locked Q4 decision: per-status, persisted to project_settings JSONB,
 * shared across the team.
 */
export function SymbologyEditor({
  projectId,
  statusId,
  initial,
  onLocalChange,
}: {
  projectId: string;
  statusId: string;
  initial: SymbologyOverride | undefined;
  onLocalChange: (next: SymbologyOverride) => void;
}) {
  const [value, setValue] = useState<SymbologyOverride>(initial ?? {});
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  // Bring local state in sync when parent reloads (e.g. project switch).
  useEffect(() => {
    setValue(initial ?? {});
  }, [initial]);

  function update(patch: Partial<SymbologyOverride>) {
    const next = { ...value, ...patch };
    setValue(next);
    onLocalChange(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus("saving");
    const seq = ++seqRef.current;
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/symbology`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides: { [statusId]: next } }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (seq === seqRef.current) setStatus("saved");
      } catch {
        if (seq === seqRef.current) setStatus("error");
      }
    }, SAVE_DEBOUNCE_MS);
  }

  async function reset() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setValue({});
    onLocalChange({});
    setStatus("saving");
    try {
      const res = await fetch(`/api/projects/${projectId}/symbology`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: { [statusId]: null } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  const size = value.size ?? SYMBOLOGY_DEFAULTS.size;
  const opacity = value.fill_opacity ?? SYMBOLOGY_DEFAULTS.fill_opacity;
  const outline = value.outline_px ?? SYMBOLOGY_DEFAULTS.outline_px;
  const hasOverrides =
    value.size !== undefined ||
    value.fill_opacity !== undefined ||
    value.outline_px !== undefined;

  return (
    <div
      className="mt-1.5 rounded-[10px] border border-dashed p-2.5"
      style={{ borderColor: "var(--bento-rule)" }}
    >
      <div className="flex items-center justify-between">
        <span className="bento-label">Symbology</span>
        <div className="flex items-center gap-2 text-[10px] text-[var(--bento-ink-3)]">
          {status === "saving" && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin" strokeWidth={2} />
              saving
            </span>
          )}
          {status === "saved" && (
            <span className="inline-flex items-center gap-1" style={{ color: "var(--bento-success)" }}>
              <Check className="h-2.5 w-2.5" strokeWidth={2} />
              saved
            </span>
          )}
          {status === "error" && (
            <span className="inline-flex items-center gap-1" style={{ color: "var(--bento-danger)" }}>
              error
            </span>
          )}
          {hasOverrides && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                reset();
              }}
              className="bento-focus inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-[var(--bento-surface-3)]"
              title="Reset to defaults"
            >
              <RotateCcw className="h-2.5 w-2.5" strokeWidth={2} />
              reset
            </button>
          )}
        </div>
      </div>

      <Slider
        label="Size"
        min={2}
        max={20}
        step={0.5}
        value={size}
        unit="px"
        accent="var(--bento-accent)"
        onChange={(v) => update({ size: v })}
        onReset={() => update({ size: undefined })}
        overridden={value.size !== undefined}
      />
      <Slider
        label="Fill"
        min={0}
        max={1}
        step={0.05}
        value={opacity}
        unit=""
        accent="var(--bento-magenta)"
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => update({ fill_opacity: v })}
        onReset={() => update({ fill_opacity: undefined })}
        overridden={value.fill_opacity !== undefined}
      />
      <Slider
        label="Outline"
        min={0}
        max={5}
        step={0.25}
        value={outline}
        unit="px"
        accent="var(--bento-warning)"
        onChange={(v) => update({ outline_px: v })}
        onReset={() => update({ outline_px: undefined })}
        overridden={value.outline_px !== undefined}
      />
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  unit,
  accent,
  format,
  onChange,
  onReset,
  overridden,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  accent: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  onReset: () => void;
  overridden: boolean;
}) {
  const display = format ? format(value) : `${value}${unit}`;
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[10.5px]">
        <span
          className="font-medium"
          style={{
            color: overridden ? "var(--bento-ink-1)" : "var(--bento-ink-3)",
          }}
        >
          {label}
        </span>
        <span className="bento-num font-mono" style={{ color: overridden ? accent : "var(--bento-ink-3)" }}>
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onReset();
        }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-0.5 h-1 w-full cursor-pointer rounded-full appearance-none"
        style={{
          accentColor: accent,
          background: `linear-gradient(to right, ${accent} 0%, ${accent} ${
            ((value - min) / (max - min)) * 100
          }%, var(--bento-rule) ${((value - min) / (max - min)) * 100}%, var(--bento-rule) 100%)`,
        }}
        title="Double-click to reset"
      />
    </div>
  );
}
