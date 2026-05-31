// components/analyses/inputs/poi-picker.tsx
"use client";
type POI = { lat: number; lon: number } | null;
type Props = {
  label: string;
  value: POI;
  onChange: (v: POI) => void;
  onRequestMapPick?: () => void;
};

export function PoiPicker({ label, value, onChange, onRequestMapPick }: Props) {
  return (
    <fieldset className="block">
      <legend className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--shell-text-muted)]">
        {label}
      </legend>
      <div className="grid grid-cols-2 gap-2 mt-1">
        <label className="text-[12px]">
          Lat
          <input
            type="number" step="0.000001"
            value={value?.lat ?? ""}
            onChange={(e) => {
              const lat = Number(e.target.value);
              onChange(Number.isFinite(lat) ? { lat, lon: value?.lon ?? 0 } : null);
            }}
            className="block w-full rounded-md border border-[var(--shell-border)] bg-[var(--shell-1)] py-1 px-2 text-[12.5px] mt-0.5"
          />
        </label>
        <label className="text-[12px]">
          Lon
          <input
            type="number" step="0.000001"
            value={value?.lon ?? ""}
            onChange={(e) => {
              const lon = Number(e.target.value);
              onChange(Number.isFinite(lon) ? { lat: value?.lat ?? 0, lon } : null);
            }}
            className="block w-full rounded-md border border-[var(--shell-border)] bg-[var(--shell-1)] py-1 px-2 text-[12.5px] mt-0.5"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={onRequestMapPick}
        disabled={!onRequestMapPick}
        className="mt-2 rounded-md border border-[var(--shell-border)] bg-[var(--shell-1)] px-2 py-1 text-[11.5px] disabled:opacity-50"
      >
        📍 Click on map to set
      </button>
    </fieldset>
  );
}
