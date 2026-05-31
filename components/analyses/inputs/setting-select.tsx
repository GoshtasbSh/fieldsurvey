// components/analyses/inputs/setting-select.tsx
"use client";
type Opt = { value: string | number; label: string };
type Props = {
  label: string;
  options: Opt[];
  value: string | number;
  onChange: (v: string | number) => void;
};
export function SettingSelect({ label, options, value, onChange }: Props) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
        {label}
      </span>
      <select
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const o = options.find((o) => String(o.value) === raw);
          onChange(o ? o.value : raw);
        }}
        className="mt-1 w-full rounded-md border border-[var(--shell-border)] bg-[var(--shell-1)] py-1.5 px-2 text-[12.5px]"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
