"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { DesktopTopbar } from "@/components/desktop/topbar";
import { DesktopLeftRail, useLeftRailState, type StatusRow } from "@/components/desktop/left-rail";
import { DesktopRightRail } from "@/components/desktop/right-rail";
import { CommandCapsule, ActiveFiltersStrip, MapLegend, MapControls, AddFab, SyncPill } from "@/components/desktop/map-overlays";
import type { MatchStatusCounts, MatchStatusRow } from "@/lib/match/status";
import type { StatusColorMap } from "@/components/map/maplibre-map";

// MapLibre touches `window` — render client-only
const MaplibreMap = dynamic(() => import("@/components/map/maplibre-map").then((m) => m.MaplibreMap), { ssr: false });

type Props = {
  projectId: string;
  projectName: string;
  center: { lat: number; lon: number; zoom: number };
  statuses: StatusRow[];
  matchCounts: MatchStatusCounts;
  features: MatchStatusRow[];
  pointsTotal: number;
  todayDelta: number;
};

export function MapShell({ projectId, projectName, center, statuses, matchCounts, features, pointsTotal, todayDelta }: Props) {
  const left = useLeftRailState();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const statusColors: StatusColorMap = useMemo(() => {
    const m: StatusColorMap = {};
    for (const s of statuses) m[s.id] = s.color;
    return m;
  }, [statuses]);

  // Apply filters to the feature set rendered on the map
  const filtered = useMemo(() => {
    const visibleStatus = left.visibleStatusIds;
    const activeStatus = left.activeStatusIds;
    return features.filter((f) => {
      if (left.activeMatch && f.match_status !== left.activeMatch) return false;
      if (f.status_id && visibleStatus.size > 0 && !visibleStatus.has(f.status_id)) return false;
      if (f.status_id && activeStatus.size > 0 && !activeStatus.has(f.status_id)) return false;
      return true;
    });
  }, [features, left.activeMatch, left.activeStatusIds, left.visibleStatusIds]);

  const activeStatusChips = useMemo(
    () => statuses.filter((s) => left.activeStatusIds.has(s.id)).map((s) => ({ id: s.id, label: s.label, color: s.color })),
    [statuses, left.activeStatusIds],
  );

  return (
    <>
      <DesktopTopbar projectName={projectName} scope="all" liveCount={0} />

      <div className="grid flex-1 grid-cols-[280px_1fr_360px] overflow-hidden">
        <DesktopLeftRail
          projectName={projectName}
          projectMeta={{ points: pointsTotal, responses: 0, active: 0 }}
          matchCounts={matchCounts}
          statuses={statuses}
          activeMatch={left.activeMatch}
          setActiveMatch={left.setActiveMatch}
          activeStatusIds={left.activeStatusIds}
          setActiveStatusIds={left.setActiveStatusIds}
          visibleStatusIds={left.visibleStatusIds.size === 0 ? new Set(statuses.map((s) => s.id)) : left.visibleStatusIds}
          setVisibleStatusIds={left.setVisibleStatusIds}
          layers={left.layers}
          setLayers={left.setLayers}
          dateRange={left.dateRange}
          setDateRange={left.setDateRange}
        />

        <div className="relative overflow-hidden bg-[oklch(14%_0.012_250)]">
          <MaplibreMap
            center={[center.lon, center.lat]}
            zoom={center.zoom ?? 14}
            features={filtered}
            statusColors={statusColors}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <CommandCapsule onAdd={() => { /* opens add-point modal in next slice */ }} onImport={() => { window.location.href = `/p/${projectId}/import`; }} />
          <ActiveFiltersStrip
            activeMatch={left.activeMatch}
            activeStatuses={activeStatusChips}
            onClearMatch={() => left.setActiveMatch(null)}
            onClearStatus={(id) => {
              const next = new Set(left.activeStatusIds);
              next.delete(id);
              left.setActiveStatusIds(next);
            }}
            onClearAll={() => {
              left.setActiveMatch(null);
              left.setActiveStatusIds(new Set());
            }}
          />
          <MapLegend counts={matchCounts} />
          <MapControls onZoomIn={() => {}} onZoomOut={() => {}} onLocate={() => {}} />
          <SyncPill lastSyncSeconds={4} refId={selectedId ?? undefined} />
          <AddFab onClick={() => { /* opens add-point modal in next slice */ }} />
        </div>

        <DesktopRightRail matchCounts={matchCounts} statuses={statuses} pointsTotal={pointsTotal} todayDelta={todayDelta} />
      </div>
    </>
  );
}
