"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { DesktopTopbar } from "@/components/desktop/topbar";
import { DesktopLeftRail, useLeftRailState, type StatusRow } from "@/components/desktop/left-rail";
import { DesktopRightRail, type DailyBucket, type SurveyorBrief, type CoverageMetrics, type ChatMember } from "@/components/desktop/right-rail";
import { CommandCapsule, ActiveFiltersStrip, MapLegend, MapControls, AddFab, SyncPill } from "@/components/desktop/map-overlays";
import { DesktopAddModal } from "@/components/desktop/add-modal";
import { CapBanner } from "@/components/desktop/cap-banner";
import { registerSyncTriggers } from "@/lib/offline/sync";
import type { MatchStatusCounts, MatchStatusRow } from "@/lib/match/status";
import type { StatusColorMap } from "@/components/map/maplibre-map";
import type { ChatMessage } from "@/lib/queries/chat";
import type { CapStatus } from "@/lib/queries/caps";

const MaplibreMap = dynamic(() => import("@/components/map/maplibre-map").then((m) => m.MaplibreMap), { ssr: false });

type Props = {
  projectId: string;
  projectName: string;
  currentUserId: string | null;
  center: { lat: number; lon: number; zoom: number };
  statuses: StatusRow[];
  matchCounts: MatchStatusCounts;
  features: MatchStatusRow[];
  pointsTotal: number;
  todayDelta: number;
  daily?: DailyBucket[];
  surveyors?: SurveyorBrief[];
  coverage?: CoverageMetrics;
  chatMembers?: ChatMember[];
  initialChat?: ChatMessage[];
  caps?: CapStatus | null;
};

export function MapShell(props: Props) {
  const router = useRouter();
  const left = useLeftRailState();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => registerSyncTriggers(props.projectId), [props.projectId]);

  const statusColors: StatusColorMap = useMemo(() => Object.fromEntries(props.statuses.map((s) => [s.id, s.color])), [props.statuses]);

  const filtered = useMemo(() => {
    const visibleStatus = left.visibleStatusIds.size === 0 ? new Set(props.statuses.map((s) => s.id)) : left.visibleStatusIds;
    return props.features.filter((f) => {
      if (left.activeMatch && f.match_status !== left.activeMatch) return false;
      if (f.status_id && !visibleStatus.has(f.status_id)) return false;
      if (f.status_id && left.activeStatusIds.size > 0 && !left.activeStatusIds.has(f.status_id)) return false;
      return true;
    });
  }, [props.features, left.activeMatch, left.activeStatusIds, left.visibleStatusIds, props.statuses]);

  const activeStatusChips = useMemo(() => props.statuses.filter((s) => left.activeStatusIds.has(s.id)).map((s) => ({ id: s.id, label: s.label, color: s.color })), [props.statuses, left.activeStatusIds]);

  return (
    <>
      <DesktopTopbar projectName={props.projectName} scope="all" liveCount={props.surveyors?.length ?? 0} />
      <CapBanner caps={props.caps ?? null} />

      <div className="grid flex-1 grid-cols-[280px_1fr_360px] overflow-hidden">
        <DesktopLeftRail
          projectName={props.projectName}
          projectMeta={{ points: props.pointsTotal, responses: props.matchCounts.m1_count + props.matchCounts.r1_count, active: props.surveyors?.length ?? 0 }}
          matchCounts={props.matchCounts}
          statuses={props.statuses}
          activeMatch={left.activeMatch}
          setActiveMatch={left.setActiveMatch}
          activeStatusIds={left.activeStatusIds}
          setActiveStatusIds={left.setActiveStatusIds}
          visibleStatusIds={left.visibleStatusIds.size === 0 ? new Set(props.statuses.map((s) => s.id)) : left.visibleStatusIds}
          setVisibleStatusIds={left.setVisibleStatusIds}
          layers={left.layers}
          setLayers={left.setLayers}
          dateRange={left.dateRange}
          setDateRange={left.setDateRange}
        />

        <div className="relative overflow-hidden bg-[oklch(14%_0.012_250)]">
          <MaplibreMap center={[props.center.lon, props.center.lat]} zoom={props.center.zoom ?? 14} features={filtered} statusColors={statusColors} selectedId={selectedId} onSelect={setSelectedId} />
          <CommandCapsule onAdd={() => setAddOpen(true)} onImport={() => router.push(`/p/${props.projectId}/import`)} />
          <ActiveFiltersStrip activeMatch={left.activeMatch} activeStatuses={activeStatusChips} onClearMatch={() => left.setActiveMatch(null)} onClearStatus={(id) => { const next = new Set(left.activeStatusIds); next.delete(id); left.setActiveStatusIds(next); }} onClearAll={() => { left.setActiveMatch(null); left.setActiveStatusIds(new Set()); }} />
          <MapLegend counts={props.matchCounts} />
          <MapControls onZoomIn={() => {}} onZoomOut={() => {}} onLocate={() => {}} />
          <SyncPill lastSyncSeconds={4} refId={selectedId ?? undefined} />
          <AddFab onClick={() => setAddOpen(true)} />
        </div>

        <DesktopRightRail
          projectId={props.projectId}
          currentUserId={props.currentUserId}
          matchCounts={props.matchCounts}
          statuses={props.statuses}
          pointsTotal={props.pointsTotal}
          todayDelta={props.todayDelta}
          daily={props.daily}
          surveyors={props.surveyors}
          coverage={props.coverage}
          chatMembers={props.chatMembers}
          initialChat={props.initialChat}
        />
      </div>

      <DesktopAddModal open={addOpen} projectId={props.projectId} statuses={props.statuses} initialCoords={{ lat: props.center.lat, lon: props.center.lon }} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); router.refresh(); }} />
    </>
  );
}
