// components/analyses/inputs/setting-toggle.tsx
"use client";
type Props = { label: string; value: boolean; onChange: (v: boolean) => void };
export function SettingToggle({ label, value, onChange }: Props) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="text-[12.5px]">{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="accent-[var(--accent-1,#0EA5E9)]"
      />
    </label>
  );
}
