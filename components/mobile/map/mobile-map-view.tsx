"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/mobile/icons/icons";
import { MobileFab } from "@/components/mobile/shell/mobile-fab";
import { MobileAddSheet } from "@/components/mobile/add-sheet";
import {
  BASEMAPS,
  type BasemapKey,
  type StatusColorMap,
} from "@/components/map/maplibre-map";
import type { StatusRow as DesktopStatusRow } from "@/components/desktop/left-rail";
import type { MatchStatusRow } from "@/lib/match/status";
import type { ProjectRole } from "@/lib/mobile/role-gate";

const MaplibreMap = dynamic(
  () => import("@/components/map/maplibre-map").then((m) => m.MaplibreMap),
  { ssr: false },
);

type StatusRow = {
  id: string;
  label: string;
  color: string;
  count: number;
};

type Props = {
  projectId: string;
  role: ProjectRole;
  center: { lat: number; lon: number; zoom: number };
  statuses: StatusRow[];
  /** Full status rows with icon + pct (needed for AddPointForm select). */
  statusRowsForAdd: DesktopStatusRow[];
  features: MatchStatusRow[];
  boundaries?: GeoJSON.FeatureCollection | null;
  myToday?: number;
  myTotal?: number;
  totalPoints: number;
  todayDelta: number;
  doneCount: number;
  offlineCount?: number;
};

/**
 * Mobile Map tab — tap-to-place add point (KeyStone parity, matches desktop):
 *
 *   FAB tap → enter place mode (cursor crosshair, hint banner shown).
 *   Tap map → captures clicked lat/lon, opens add-sheet pre-filled with
 *             those coords. NEVER uses navigator.geolocation; the user's
 *             current GPS is irrelevant to which house they're recording.
 *   FAB tap during place mode → cancel.
 *   Escape (hardware/keyboard) → cancel place mode.
 *
 * This intentionally mirrors components/desktop/map-shell.tsx handleStartPlace
 * / handleMapPlace flow.
 */
export function MobileMapView({
  projectId,
  role,
  center,
  statuses,
  statusRowsForAdd,
  features,
  boundaries = null,
  myToday = 0,
  myTotal = 0,
  totalPoints,
  todayDelta,
  doneCount,
  offlineCount = 0,
}: Props) {
  const router = useRouter();
  const [basemap, setBasemap] = useState<BasemapKey>("satellite");
  const [basemapOpen, setBasemapOpen] = useState(false);
  const [activeStatusIds, setActiveStatusIds] = useState<Set<string>>(new Set());
  const [strip, setStrip] = useState<"open" | "closed">("open");

  // Tap-to-place state — desktop-parity.
  const [placingMode, setPlacingMode] = useState(false);
  const [placeCoords, setPlaceCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const statusColors: StatusColorMap = useMemo(
    () => Object.fromEntries(statuses.map((s) => [s.id, s.color])),
    [statuses],
  );

  const filtered = useMemo(() => {
    if (activeStatusIds.size === 0) return features;
    return features.filter((f) => f.status_id && activeStatusIds.has(f.status_id));
  }, [features, activeStatusIds]);

  function toggleStatus(id: string) {
    setActiveStatusIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleStartPlace() {
    setPlacingMode(true);
  }
  function handleCancelPlace() {
    setPlacingMode(false);
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
  function handleSaved() {
    setAddOpen(false);
    setPlaceCoords(null);
    router.refresh();
  }

  // ESC cancels place mode (keyboard accessibility + external Bluetooth keyboard).
  useEffect(() => {
    if (!placingMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPlacingMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placingMode]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        center={[center.lon, center.lat]}
        zoom={center.zoom}
        features={filtered}
        statusColors={statusColors}
        selectedId={null}
        onSelect={() => {}}
        basemap={basemap}
        boundaries={boundaries}
        placingMode={placingMode}
        onPlace={handleMapPlace}
      />

      {/* Place-mode hint banner — covers the top of the map while active */}
      {placingMode ? (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            right: 60, // leaves room for the utility column
            zIndex: 5,
            background: "var(--m-accent)",
            color: "var(--m-accent-on)",
            padding: "10px 14px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            boxShadow: "0 8px 20px rgba(0,0,0,0.35)",
          }}
        >
          <span>Tap the map where the point should go.</span>
          <button
            type="button"
            onClick={handleCancelPlace}
            aria-label="Cancel place mode"
            style={{
              background: "rgba(0,0,0,0.15)",
              color: "inherit",
              border: "none",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {/* Top-right utility column */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 2,
        }}
      >
        <UtilityButton ariaLabel="My location" onClick={() => {}}>
          <Icon name="locate" />
        </UtilityButton>
        <UtilityButton ariaLabel="Change basemap" onClick={() => setBasemapOpen((v) => !v)}>
          <span style={{ fontSize: 14, fontWeight: 800 }}>
            {basemap === "satellite" ? "S" : basemap === "streets" ? "M" : "L"}
          </span>
        </UtilityButton>
      </div>

      {basemapOpen ? (
        <BasemapSheet
          active={basemap}
          onChoose={(k) => {
            setBasemap(k);
            setBasemapOpen(false);
          }}
          onClose={() => setBasemapOpen(false)}
        />
      ) : null}

      <FilterStrip
        statuses={statuses}
        active={activeStatusIds}
        onToggle={toggleStatus}
        bottomOffset={strip === "open" && role !== "guest" ? 56 : 8}
      />

      {role !== "guest" ? (
        <StatStrip
          open={strip === "open"}
          onToggle={() => setStrip((v) => (v === "open" ? "closed" : "open"))}
          role={role}
          totalPoints={totalPoints}
          todayDelta={todayDelta}
          doneCount={doneCount}
          myToday={myToday}
          myTotal={myTotal}
        />
      ) : null}

      {/* FAB — toggles place mode (desktop parity). Active state visible. */}
      <MobileFab
        onClick={() => (placingMode ? handleCancelPlace() : handleStartPlace())}
        badge={offlineCount}
        bottomOffset={role !== "guest" && strip === "open" ? 116 : 76}
        ariaLabel={placingMode ? "Cancel adding point" : "Add point"}
      />

      <MobileAddSheet
        open={addOpen}
        projectId={projectId}
        statuses={statusRowsForAdd}
        initialCoords={placeCoords ?? undefined}
        onClose={handleAddClose}
        onSaved={handleSaved}
      />
    </div>
  );
}

function UtilityButton({
  ariaLabel,
  onClick,
  children,
}: {
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        background: "rgba(0,0,0,0.72)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: "var(--m-ink)",
        display: "grid",
        placeItems: "center",
        backdropFilter: "blur(6px)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function BasemapSheet({
  active,
  onChoose,
  onClose,
}: {
  active: BasemapKey;
  onChoose: (k: BasemapKey) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 5,
          background: "rgba(0,0,0,0.25)",
        }}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label="Basemap"
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          bottom: 100,
          zIndex: 6,
          background: "var(--m-bg-2)",
          border: "1px solid var(--m-line)",
          borderRadius: 14,
          padding: 8,
          boxShadow: "0 24px 48px rgba(0,0,0,.45)",
        }}
      >
        {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChoose(k)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
              padding: "12px 12px",
              background: active === k ? "var(--m-accent-dim)" : "transparent",
              border: "none",
              borderRadius: 10,
              color: "var(--m-ink)",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: active === k ? "var(--m-accent)" : "var(--m-line-2)",
              }}
            />
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>
                {BASEMAPS[k].label}
              </span>
              <span style={{ display: "block", fontSize: 11, color: "var(--m-ink-2)" }}>
                {BASEMAPS[k].subtitle}
              </span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function FilterStrip({
  statuses,
  active,
  onToggle,
  bottomOffset,
}: {
  statuses: StatusRow[];
  active: Set<string>;
  onToggle: (id: string) => void;
  bottomOffset: number;
}) {
  if (statuses.length === 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: bottomOffset,
        left: 0,
        right: 0,
        padding: "6px 12px",
        display: "flex",
        gap: 6,
        overflowX: "auto",
        zIndex: 2,
        WebkitOverflowScrolling: "touch",
      }}
      className="m-no-scrollbar"
    >
      <FilterChip
        label="All"
        count={statuses.reduce((sum, s) => sum + s.count, 0)}
        active={active.size === 0}
        onClick={() => {
          if (active.size > 0) statuses.forEach((s) => onToggle(s.id));
        }}
      />
      {statuses.map((s) => (
        <FilterChip
          key={s.id}
          label={s.label}
          count={s.count}
          color={s.color}
          active={active.has(s.id)}
          onClick={() => onToggle(s.id)}
        />
      ))}
    </div>
  );
}

function FilterChip({
  label,
  count,
  color,
  active,
  onClick,
}: {
  label: string;
  count: number;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        borderRadius: 100,
        background: active ? "var(--m-accent)" : "rgba(13,17,23,0.85)",
        color: active ? "var(--m-accent-on)" : "var(--m-ink)",
        border: active ? "1px solid var(--m-accent)" : "1px solid rgba(255,255,255,0.08)",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        cursor: "pointer",
        backdropFilter: "blur(6px)",
      }}
    >
      {color ? (
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color,
            display: active ? "none" : "inline-block",
          }}
        />
      ) : null}
      {label}
      <span style={{ opacity: 0.7, fontFamily: "ui-monospace, Menlo, monospace" }}>
        {count}
      </span>
    </button>
  );
}

function StatStrip({
  open,
  onToggle,
  role,
  totalPoints,
  todayDelta,
  doneCount,
  myToday,
  myTotal,
}: {
  open: boolean;
  onToggle: () => void;
  role: ProjectRole;
  totalPoints: number;
  todayDelta: number;
  doneCount: number;
  myToday: number;
  myTotal: number;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="Show stats"
        style={{
          position: "absolute",
          bottom: 8,
          right: 60,
          padding: "6px 12px",
          borderRadius: 100,
          background: "rgba(13,17,23,0.85)",
          color: "var(--m-ink)",
          border: "1px solid rgba(255,255,255,0.08)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          cursor: "pointer",
          backdropFilter: "blur(6px)",
          zIndex: 2,
        }}
      >
        Stats
      </button>
    );
  }
  return (
    <div
      style={{
        position: "absolute",
        bottom: 8,
        left: 0,
        right: 0,
        padding: "8px 14px",
        margin: "0 12px",
        background: "rgba(22,27,34,0.95)",
        border: "1px solid var(--m-line)",
        borderRadius: 12,
        display: "flex",
        justifyContent: "space-around",
        alignItems: "center",
        zIndex: 2,
        backdropFilter: "blur(12px)",
      }}
    >
      <Stat n={totalPoints} l="Total" />
      <Divider />
      <Stat n={`+${todayDelta}`} l="Today" />
      <Divider />
      {role === "admin" ? <Stat n={doneCount} l="Done" /> : <Stat n={myTotal} l="Mine" />}
      {role !== "admin" ? null : (
        <>
          <Divider />
          <Stat n={`${myToday}`} l="Mine·Today" />
        </>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-label="Hide stats"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--m-ink-3)",
          cursor: "pointer",
          marginLeft: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}

function Stat({ n, l }: { n: number | string; l: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
      <span style={{ fontSize: 14, fontWeight: 800, color: "var(--m-ink)" }}>{n}</span>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--m-ink-3)",
        }}
      >
        {l}
      </span>
    </div>
  );
}

function Divider() {
  return <span style={{ width: 1, height: 22, background: "var(--m-line)" }} />;
}
