"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { DesktopTopbar } from "@/components/desktop/topbar";
import { DesktopLeftRail, useLeftRailState, type StatusRow } from "@/components/desktop/left-rail";
import { DesktopRightRail, type DailyBucket, type SurveyorBrief, type CoverageMetrics } from "@/components/desktop/right-rail";
import { CommandCapsule, ActiveFiltersStrip, MapLegend, MapControls, AddFab, SyncPill } from "@/components/desktop/map-overlays";
import { DesktopAddModal } from "@/components/desktop/add-modal";
import { registerSyncTriggers } from "@/lib/offline/sync";
import type { MatchStatusCounts, MatchStatusRow } from "@/lib/match/status";
import type { StatusColorMap } from "@/components/map/maplibre-map";

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
  daily?: DailyBucket[];
  surveyors?: SurveyorBrief[];
  coverage?: CoverageMetrics;
};

export function MapShell({ projectId, projectName, center, statuses, matchCounts, features, pointsTotal, todayDelta, daily, surveyors, coverage }: Props) {
  const router = useRouter();
  const left = useLeftRailState();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => registerSyncTriggers(projectId), [projectId]);

  const statusColors: StatusColorMap = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s.color])), [statuses]);

  const filtered = useMemo(() => {
    const visibleStatus = left.visibleStatusIds.size === 0 ? new Set(statuses.map((s) => s.id)) : left.visibleStatusIds;
    return features.filter((f) => {
      if (left.activeMatch && f.match_status !== left.activeMatch) return false;
      if (f.status_id && !visibleStatus.has(f.status_id)) return false;
      if (f.status_id && left.activeStatusIds.size > 0 && !left.activeStatusIds.has(f.status_id)) return false;
      return true;
    });
  }, [features, left.activeMatch, left.activeStatusIds, left.visibleStatusIds, statuses]);

  const activeStatusChips = useMemo(
    () => statuses.filter((s) => left.activeStatusIds.has(s.id)).map((s) => ({ id: s.id, label: s.label, color: s.color })),
    [statuses, left.activeStatusIds],
  );

  return (
    <>
      <DesktopTopbar projectName={projectName} scope="all" liveCount={surveyors?.length ?? 0} />

      <div className="grid flex-1 grid-cols-[280px_1fr_360px] overflow-hidden">
        <DesktopLeftRail
          projectName={projectName}
          projectMeta={{ points: pointsTotal, responses: matchCounts.m1_count + matchCounts.r1_count, active: surveyors?.length ?? 0 }}
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
          <CommandCapsule onAdd={() => setAddOpen(true)} onImport={() => router.push(`/p/${projectId}/import`)} />
          <ActiveFiltersStrip
            activeMatch={left.activeMatch}
            activeStatuses={activeStatusChips}
            onClearMatch={() => left.setActiveMatch(null)}
            onClearStatus={(id) => { const next = new Set(left.activeStatusIds); next.delete(id); left.setActiveStatusIds(next); }}
            onClearAll={() => { left.setActiveMatch(null); left.setActiveStatusIds(new Set()); }}
          />
          <MapLegend counts={matchCounts} />
          <MapControls onZoomIn={() => {}} onZoomOut={() => {}} onLocate={() => {}} />
          <SyncPill lastSyncSeconds={4} refId={selectedId ?? undefined} />
          <AddFab onClick={() => setAddOpen(true)} />
        </div>

        <DesktopRightRail
          matchCounts={matchCounts}
          statuses={statuses}
          pointsTotal={pointsTotal}
          todayDelta={todayDelta}
          daily={daily}
          surveyors={surveyors}
          coverage={coverage}
        />
      </div>

      <DesktopAddModal
        open={addOpen}
        projectId={projectId}
        statuses={statuses}
        initialCoords={{ lat: center.lat, lon: center.lon }}
        onClose={() => setAddOpen(false)}
        onSaved={() => { setAddOpen(false); router.refresh(); }}
      />
    </>
  );
}
