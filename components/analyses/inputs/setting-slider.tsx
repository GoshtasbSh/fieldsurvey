// components/analyses/inputs/setting-slider.tsx
"use client";
type Props = {
  label: string;
  min: number; max: number; step: number;
  value: number;
  onChange: (v: number) => void;
};
export function SettingSlider({ label, min, max, step, value, onChange }: Props) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
        {label}
      </span>
      <div className="flex items-center gap-3 mt-1">
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
          className="flex-1 accent-[var(--accent-1,#0EA5E9)]"
          aria-label={label}
        />
        <span className="font-mono text-[12px] tabular-nums min-w-[3.5rem] text-right">
          {value.toFixed(step < 1 ? 2 : 0)}
        </span>
      </div>
    </label>
  );
}
