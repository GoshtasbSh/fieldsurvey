"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DesktopTopbar } from "@/components/desktop/topbar";
import { DesktopLeftRail, useLeftRailState, type StatusRow } from "@/components/desktop/left-rail";
import type { SymbologyMap } from "@/components/desktop/symbology-editor";
import {
  RestoredViewProvider,
  RestoredViewBanner,
} from "@/components/desktop/history-dropdown";
import { DesktopRightRail, type DailyBucket, type SurveyorBrief, type CoverageMetrics, type ChatMember, type CanvassBlob } from "@/components/desktop/right-rail";
import { CommandCapsule, ActiveFiltersStrip, MapLegend, MapControls, AddFab, SyncPill, BasemapSwitcher, PlaceHintBanner } from "@/components/desktop/map-overlays";
import { DesktopAddModal } from "@/components/desktop/add-modal";
import { CapBanner } from "@/components/desktop/cap-banner";
import { registerSyncTriggers } from "@/lib/offline/sync";
import type { MatchStatusCounts, MatchStatusRow } from "@/lib/match/status";
import { categorizeStatus } from "@/lib/match/status-categorize";
import type { StatusColorMap, MapHandle, BasemapKey } from "@/components/map/maplibre-map";
import type { ChatMessage } from "@/lib/queries/chat";
import type { CapStatus } from "@/lib/queries/caps";
import type { HourBucket, DowBucket } from "@/lib/queries/analytics";
import { useColorizer } from "@/lib/colorize/use-colorizer";
import { ColorizerControl } from "@/components/map/colorizer-control";
import { usePinnedLayers } from "@/hooks/use-pinned-layers";

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
  /** ISO timestamp of the freshest dashboard_cache row; null when no cache exists. */
  cachedAt?: string | null;
  /** Cached canvass blob; passed through to Pulse tab when enabled. */
  canvass?: CanvassBlob | null;
  /** Project boundaries as a single FeatureCollection (M6). */
  boundaries?: GeoJSON.FeatureCollection | null;
  /** M7: Saved Views available to this viewer (server-fetched, role-filtered). */
  savedViews?: Array<{ id: string; name: string; cards: string[]; description: string | null; role_gate: string; is_default: boolean }>;
  /** M7: viewer's currently active view id (from user_view_state or null = default). */
  initialActiveViewId?: string | null;
};

export function MapShell(props: Props) {
  const router = useRouter();
  const left = useLeftRailState();

  const {
    layers: pinnedLayers,
    loading: pinnedLayersLoading,
    pin: pinAnalysisLayer,
    unpin: unpinAnalysisLayer,
    toggleVisibility: togglePinnedVisibility,
    rename: renamePinnedLayer,
  } = usePinnedLayers(props.projectId);

  const [pinnedSettingsTarget, setPinnedSettingsTarget] = useState<{ cardId: string; pinnedAt: string } | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [placeCoords, setPlaceCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [placingMode, setPlacingMode] = useState(false);
  const [basemap, setBasemap] = useState<BasemapKey>("satellite");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [symbology, setSymbology] = useState<SymbologyMap>({});

  // Load saved symbology once on mount; sliders patch via their own endpoint.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${props.projectId}/symbology`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.overrides) return;
        setSymbology(j.overrides as SymbologyMap);
      })
      .catch(() => { /* leave defaults */ });
    return () => {
      cancelled = true;
    };
  }, [props.projectId]);

  // Role-derived capability flags. See lib/auth/role.ts for full matrix.
  const role = (props.currentUser?.role ?? null) as
    | "owner"
    | "admin"
    | "surveyor"
    | "viewer"
    | null;
  const canEditSymbology = role === "owner" || role === "admin" || role === "surveyor";
  const canEditPoints = role === "owner" || role === "admin" || role === "surveyor";
  const canImport = role === "owner" || role === "admin";

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

  // label → status_id lookup so R1 features (which only carry a free-form
  // status_label, no status_id) can be filtered by the same eye-toggle as
  // field points. props.statuses already includes the synthetic canonical
  // buckets ("Left Info", "Vacant", "Unknown") that getStatusBreakdown
  // appends when the project hasn't typed them explicitly.
  const statusIdByLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of props.statuses) m.set(s.label.toLowerCase(), s.id);
    return m;
  }, [props.statuses]);

  const filtered = useMemo(() => {
    const visibleStatus =
      left.visibleStatusIds.size === 0
        ? new Set(props.statuses.map((s) => s.id))
        : left.visibleStatusIds;
    return props.features.filter((f) => {
      if (left.activeMatch && f.match_status !== left.activeMatch) return false;
      // Resolve effective status_id: field points carry it directly; R1
      // responses categorize their free-form status_label → canonical label
      // → id via statusIdByLabel.
      let effectiveStatusId = f.status_id;
      if (!effectiveStatusId && f.match_status === "R1") {
        const canonical = categorizeStatus(f.status_label);
        effectiveStatusId = statusIdByLabel.get(canonical.toLowerCase()) ?? null;
      }
      if (effectiveStatusId && !visibleStatus.has(effectiveStatusId)) return false;
      if (effectiveStatusId && left.activeStatusIds.size > 0 && !left.activeStatusIds.has(effectiveStatusId)) return false;
      if (dateThreshold && (!f.collected_at || f.collected_at < dateThreshold)) return false;
      return true;
    });
  }, [props.features, left.activeMatch, left.activeStatusIds, left.visibleStatusIds, props.statuses, dateThreshold, statusIdByLabel]);

  // A0 question colorizer — repaints the map by any survey response column.
  const colorizer = useColorizer(props.projectId, filtered);

  // M7 — Saved Views switcher. Source of truth is `activeViewId`; we look up
  // the cards list from `props.savedViews` so switching is instant client-side.
  const [activeViewId, setActiveViewId] = useState<string | null>(() => {
    if (props.initialActiveViewId) return props.initialActiveViewId;
    return props.savedViews?.find((v) => v.is_default)?.id ?? null;
  });
  const activeViewCards = useMemo(() => {
    const v = props.savedViews?.find((vv) => vv.id === activeViewId);
    return v?.cards ?? [];
  }, [props.savedViews, activeViewId]);
  async function handleSwitchView(viewId: string) {
    setActiveViewId(viewId);
    try {
      await fetch(`/api/projects/${props.projectId}/saved-views/switch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ viewId }),
      });
    } catch {
      // non-blocking — switcher is optimistic, will resync on next page load
    }
  }
  const savedViewNames = useMemo(
    () => (props.savedViews ?? []).map((v) => v.name),
    [props.savedViews],
  );

  const activeStatusChips = useMemo(
    () =>
      props.statuses
        .filter((s) => left.activeStatusIds.has(s.id))
        .map((s) => ({ id: s.id, label: s.label, color: s.color })),
    [props.statuses, left.activeStatusIds],
  );

  return (
    <RestoredViewProvider>
      <DesktopTopbar
        projectName={props.projectName}
        projectId={props.projectId}
        scope="all"
        liveCount={props.surveyors?.length ?? 0}
        user={props.currentUser ?? null}
        cachedAt={props.cachedAt ?? null}
      />
      <RestoredViewBanner />
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
            symbology={symbology}
            setSymbology={setSymbology}
            canEditSymbology={canEditSymbology}
            onCollapse={() => setLeftOpen(false)}
            savedViews={(props.savedViews ?? []).map((v) => ({
              id: v.id, name: v.name, description: v.description, role_gate: v.role_gate,
            }))}
            activeViewId={activeViewId}
            onSwitchView={handleSwitchView}
            pinnedLayers={pinnedLayers}
            pinnedLayersLoading={pinnedLayersLoading}
            onTogglePinnedVisibility={togglePinnedVisibility}
            onUnpinLayer={unpinAnalysisLayer}
            onOpenPinnedSettings={(cardId, pinnedAt) => setPinnedSettingsTarget({ cardId, pinnedAt })}
            onRenamePinnedLayer={renamePinnedLayer}
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
            symbology={symbology}
            boundaries={props.boundaries ?? null}
            featureColors={colorizer.featureColors}
            responseStatuses={props.statuses.map((s) => ({ label: s.label, color: s.color }))}
          />

          {/* A0 colorizer — pick a survey response column to repaint the map */}
          <div className="absolute left-3 top-3 z-30">
            <ColorizerControl
              profiles={colorizer.profiles}
              selectedValues={colorizer.selectedNumericValues}
              spec={colorizer.spec}
              onChange={colorizer.setSpec}
            />
          </div>

          <CommandCapsule
            onAdd={handleStartPlace}
            onImport={() => router.push(`/p/${props.projectId}/import`)}
            canEdit={canEditPoints}
            canImport={canImport}
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
          {canEditPoints && (
            <AddFab
              onClick={() => (placingMode ? setPlacingMode(false) : handleStartPlace())}
              active={placingMode}
            />
          )}

          {/* Left panel re-open button */}
          {!leftOpen && (
            <button
              onClick={() => setLeftOpen(true)}
              className="bento-focus absolute left-3 top-1/2 z-30 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--bento-rule)] bg-[var(--shell-base-alpha-86)] text-[var(--bento-ink-2)] backdrop-blur-[16px] transition hover:text-[var(--bento-accent)]"
              style={{ boxShadow: "var(--bento-shadow-md)" }}
              aria-label="Open left panel"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
            </button>
          )}

          {/* Right panel re-open button */}
          {!rightOpen && (
            <button
              onClick={() => setRightOpen(true)}
              className="bento-focus absolute right-3 top-1/2 z-30 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--bento-rule)] bg-[var(--shell-base-alpha-86)] text-[var(--bento-ink-2)] backdrop-blur-[16px] transition hover:text-[var(--bento-accent)]"
              style={{ boxShadow: "var(--bento-shadow-md)" }}
              aria-label="Open right panel"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
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
            canWriteChat={canEditPoints}
            canvass={props.canvass ?? null}
            onCollapse={() => setRightOpen(false)}
            userRole={role}
            savedViewNames={savedViewNames}
            activeViewCards={activeViewCards}
            onPin={(cardId, cardName, settings, result) => {
              void pinAnalysisLayer({
                cardId,
                layerName: cardName,
                settings,
                visible: true,
                cachedResult: result,
              });
            }}
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
    </RestoredViewProvider>
  );
}
