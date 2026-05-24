"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DesktopTopbar } from "@/components/desktop/topbar";
import { DesktopLeftRail, useLeftRailState, type StatusRow } from "@/components/desktop/left-rail";
import { DesktopRightRail, type DailyBucket, type SurveyorBrief, type CoverageMetrics, type ChatMember } from "@/components/desktop/right-rail";
import { CommandCapsule, ActiveFiltersStrip, MapLegend, MapControls, AddFab, SyncPill, BasemapSwitcher, PlaceHintBanner } from "@/components/desktop/map-overlays";
import { DesktopAddModal } from "@/components/desktop/add-modal";
import { CapBanner } from "@/components/desktop/cap-banner";
import { registerSyncTriggers } from "@/lib/offline/sync";
import type { MatchStatusCounts, MatchStatusRow } from "@/lib/match/status";
import type { StatusColorMap, MapHandle, BasemapKey } from "@/components/map/maplibre-map";
import type { ChatMessage } from "@/lib/queries/chat";
import type { CapStatus } from "@/lib/queries/caps";
import type { HourBucket, DowBucket } from "@/lib/queries/analytics";

const MaplibreMap = dynamic(
  () => import("@/components/map/maplibre-map").then((m) => m.MaplibreMap),
  { ssr: false },
);

type Props = {
  projectId: string;
  projectName: string;
  currentUserId: string | null;
  currentUser?: {
    email: string | null;
    displayName: string | null;
    role: string | null;
  } | null;
  center: { lat: number; lon: number; zoom: number };
  statuses: StatusRow[];
  matchCounts: MatchStatusCounts;
  features: MatchStatusRow[];
  pointsTotal: number;
  todayDelta: number;
  daily?: DailyBucket[];
  hourly?: HourBucket[];
  dow?: DowBucket[];
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
  const [placeCoords, setPlaceCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [placingMode, setPlacingMode] = useState(false);
  const [basemap, setBasemap] = useState<BasemapKey>("satellite");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  // Ref forwarded into MaplibreMap so MapControls can call zoom/locate
  const mapHandleRef = useRef<MapHandle | null>(null);

  useEffect(() => registerSyncTriggers(props.projectId), [props.projectId]);

  // ESC cancels placing mode.
  useEffect(() => {
    if (!placingMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPlacingMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placingMode]);

  function handleStartPlace() {
    setPlacingMode(true);
  }
  function handleMapPlace(c: { lat: number; lon: number }) {
    setPlacingMode(false);
    setPlaceCoords(c);
    setAddOpen(true);
  }
  function handleAddClose() {
    setAddOpen(false);
    setPlaceCoords(null);
  }

  const statusColors: StatusColorMap = useMemo(
    () => Object.fromEntries(props.statuses.map((s) => [s.id, s.color])),
    [props.statuses],
  );

  const dateThreshold = useMemo((): string | null => {
    if (left.dateRange === "all") return null;
    const now = Date.now();
    if (left.dateRange === "today") {
      const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString();
    }
    if (left.dateRange === "7d") return new Date(now - 7 * 864e5).toISOString();
    if (left.dateRange === "30d") return new Date(now - 30 * 864e5).toISOString();
    return null;
  }, [left.dateRange]);

  const filtered = useMemo(() => {
    const visibleStatus =
      left.visibleStatusIds.size === 0
        ? new Set(props.statuses.map((s) => s.id))
        : left.visibleStatusIds;
    return props.features.filter((f) => {
      if (left.activeMatch && f.match_status !== left.activeMatch) return false;
      if (f.status_id && !visibleStatus.has(f.status_id)) return false;
      if (f.status_id && left.activeStatusIds.size > 0 && !left.activeStatusIds.has(f.status_id)) return false;
      if (dateThreshold && (!f.collected_at || f.collected_at < dateThreshold)) return false;
      return true;
    });
  }, [props.features, left.activeMatch, left.activeStatusIds, left.visibleStatusIds, props.statuses, dateThreshold]);

  const activeStatusChips = useMemo(
    () =>
      props.statuses
        .filter((s) => left.activeStatusIds.has(s.id))
        .map((s) => ({ id: s.id, label: s.label, color: s.color })),
    [props.statuses, left.activeStatusIds],
  );

  return (
    <>
      <DesktopTopbar
        projectName={props.projectName}
        projectId={props.projectId}
        scope="all"
        liveCount={props.surveyors?.length ?? 0}
        user={props.currentUser ?? null}
      />
      <CapBanner caps={props.caps ?? null} />

      <div
        className="grid flex-1 overflow-hidden transition-[grid-template-columns] duration-300 ease-in-out"
        style={{
          gridTemplateColumns: `${leftOpen ? "280px" : "0px"} 1fr ${rightOpen ? "360px" : "0px"}`,
        }}
      >
        {/* ── Left rail ── */}
        <div className={`overflow-hidden ${leftOpen ? "" : "w-0"}`}>
          <DesktopLeftRail
            projectName={props.projectName}
            projectId={props.projectId}
            projectMeta={{
              points: props.pointsTotal,
              responses: props.matchCounts.m1_count + props.matchCounts.r1_count,
              active: props.surveyors?.length ?? 0,
            }}
            matchCounts={props.matchCounts}
            statuses={props.statuses}
            activeMatch={left.activeMatch}
            setActiveMatch={left.setActiveMatch}
            activeStatusIds={left.activeStatusIds}
            setActiveStatusIds={left.setActiveStatusIds}
            visibleStatusIds={
              left.visibleStatusIds.size === 0
                ? new Set(props.statuses.map((s) => s.id))
                : left.visibleStatusIds
            }
            setVisibleStatusIds={left.setVisibleStatusIds}
            layers={left.layers}
            setLayers={left.setLayers}
            dateRange={left.dateRange}
            setDateRange={left.setDateRange}
            onCollapse={() => setLeftOpen(false)}
          />
        </div>

        {/* ── Map center ── */}
        <div className="relative overflow-hidden bg-[var(--shell-base)]">
          <MaplibreMap
            ref={mapHandleRef}
            center={[props.center.lon, props.center.lat]}
            zoom={props.center.zoom ?? 14}
            features={filtered}
            statusColors={statusColors}
            selectedId={selectedId}
            onSelect={setSelectedId}
            layers={left.layers}
            basemap={basemap}
            placingMode={placingMode}
            onPlace={handleMapPlace}
          />

          <CommandCapsule
            onAdd={handleStartPlace}
            onImport={() => router.push(`/p/${props.projectId}/import`)}
          />
          <PlaceHintBanner visible={placingMode} onCancel={() => setPlacingMode(false)} />
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
          <MapLegend counts={props.matchCounts} />
          <MapControls
            onZoomIn={() => mapHandleRef.current?.zoomIn()}
            onZoomOut={() => mapHandleRef.current?.zoomOut()}
            onLocate={() => mapHandleRef.current?.flyToCurrentLocation()}
          />
          <BasemapSwitcher value={basemap} onChange={setBasemap} />
          <SyncPill lastSyncSeconds={4} refId={selectedId ?? undefined} />
          <AddFab
            onClick={() => (placingMode ? setPlacingMode(false) : handleStartPlace())}
            active={placingMode}
          />

          {/* Left panel re-open button */}
          {!leftOpen && (
            <button
              onClick={() => setLeftOpen(true)}
              className="absolute left-3 top-1/2 z-30 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--shell-border)] bg-[var(--shell-base-alpha-86)] text-[var(--shell-text-2)] shadow-lg backdrop-blur-[16px] transition hover:border-[oklch(78%_0.155_234/0.4)] hover:text-[oklch(78%_0.155_234)]"
              aria-label="Open left panel"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.7} />
            </button>
          )}

          {/* Right panel re-open button */}
          {!rightOpen && (
            <button
              onClick={() => setRightOpen(true)}
              className="absolute right-3 top-1/2 z-30 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--shell-border)] bg-[var(--shell-base-alpha-86)] text-[var(--shell-text-2)] shadow-lg backdrop-blur-[16px] transition hover:border-[oklch(78%_0.155_234/0.4)] hover:text-[oklch(78%_0.155_234)]"
              aria-label="Open right panel"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.7} />
            </button>
          )}
        </div>

        {/* ── Right rail ── */}
        <div className={`overflow-hidden ${rightOpen ? "" : "w-0"}`}>
          <DesktopRightRail
            projectId={props.projectId}
            currentUserId={props.currentUserId}
            matchCounts={props.matchCounts}
            statuses={props.statuses}
            pointsTotal={props.pointsTotal}
            todayDelta={props.todayDelta}
            daily={props.daily}
            hourly={props.hourly}
            dow={props.dow}
            surveyors={props.surveyors}
            coverage={props.coverage}
            chatMembers={props.chatMembers}
            initialChat={props.initialChat}
            onCollapse={() => setRightOpen(false)}
          />
        </div>
      </div>

      <DesktopAddModal
        open={addOpen}
        projectId={props.projectId}
        statuses={props.statuses}
        initialCoords={placeCoords ?? undefined}
        onClose={handleAddClose}
        onSaved={() => { handleAddClose(); router.refresh(); }}
      />
    </>
  );
}
