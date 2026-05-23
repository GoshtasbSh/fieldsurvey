"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { MatchStatusCounts, MatchStatusRow } from "@/lib/match/status";
import type { StatusColorMap } from "@/components/map/maplibre-map";
import { MapLegend } from "@/components/desktop/map-overlays";

const MaplibreMap = dynamic(() => import("@/components/map/maplibre-map").then((m) => m.MaplibreMap), { ssr: false });

type Status = { id: string; label: string; color: string; count: number; pct: number };

export function PublicMap({ center, statuses, matchCounts, features }: { projectName: string; center: { lat: number; lon: number; zoom: number }; statuses: Status[]; matchCounts: MatchStatusCounts; features: MatchStatusRow[] }) {
  const colors: StatusColorMap = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s.color])), [statuses]);
  return (
    <div className="relative flex-1 overflow-hidden">
      <MaplibreMap center={[center.lon, center.lat]} zoom={center.zoom ?? 14} features={features} statusColors={colors} selectedId={null} onSelect={() => {}} />
      <MapLegend counts={matchCounts} />
      <div className="absolute top-[18px] right-[18px] z-20 rounded-xl border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(14%_0.012_250/0.85)] p-3 backdrop-blur-[14px]">
        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[oklch(58%_0.014_250)]">Status</div>
        <div className="mt-2 space-y-1">
          {statuses.map((s) => (
            <div key={s.id} className="flex items-center gap-2 text-[11px]">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="flex-1 text-[oklch(76%_0.012_250)]">{s.label}</span>
              <span className="font-mono tabular-nums text-[oklch(96%_0.008_250)]">{s.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
