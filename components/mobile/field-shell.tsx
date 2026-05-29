"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Map as MapIcon,
  Users,
  MoreHorizontal,
  ChevronLeft,
  Layers,
  X,
  Check,
  Wifi,
  ListChecks,
} from "lucide-react";
import type { StatusRow } from "@/components/desktop/left-rail";
import { BASEMAPS, type BasemapKey, type StatusColorMap } from "@/components/map/maplibre-map";
import { UserMenu, type UserMenuUser } from "@/components/user-menu";
import { MobileAddSheet } from "@/components/mobile/add-sheet";
import { MorePanel } from "@/components/mobile/more-panel";
import { ToVisitList } from "@/components/mobile/to-visit-list";
import { useOutboxCount } from "@/components/mobile/sync-queue-panel";
import { MobilePointSheet } from "@/components/mobile/point-sheet";
import { IosInstallBanner } from "@/components/mobile/ios-install-banner";
import { ChatPanel } from "@/components/chat/chat-panel";
import type { ChatMessage } from "@/lib/queries/chat";
import type { MatchStatusRow } from "@/lib/match/status";
import { registerSyncTriggers } from "@/lib/offline/sync";

const MaplibreMap = dynamic(
  () => import("@/components/map/maplibre-map").then((m) => m.MaplibreMap),
  { ssr: false },
);

type ChatMember = { user_id: string; display_name: string; email: string; avatar_url: string | null };
type Props = {
  projectId: string;
  projectName: string;
  currentUserId: string | null;
  currentUser?: UserMenuUser;
  center: { lat: number; lon: number; zoom: number };
  statuses: StatusRow[];
  chatMembers: ChatMember[];
  initialChat: ChatMessage[];
  /**
   * Mobile-safe map features: ONLY field points (no R1 response-only),
   * and match_status nulled out so no rings render. See mobile scope memo.
   */
  features: MatchStatusRow[];
  myStats: { today: number; total: number };
  /** True when the project has opted into universe-driven canvassing. */
  canvassMode?: boolean;
  /** Project boundary polygons (M6). Read-only on mobile. */
  boundaries?: GeoJSON.FeatureCollection | null;
};

export function MobileFieldShell({
  projectId,
  projectName,
  currentUserId,
  currentUser,
  center,
  statuses,
  chatMembers,
  initialChat,
  features,
  myStats,
  canvassMode = false,
  boundaries = null,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"map" | "team" | "more" | "universe">("map");
  const [activeStatusIds, setActiveStatusIds] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<BasemapKey>("satellite");
  const [basemapOpen, setBasemapOpen] = useState(false);
  const [placingMode, setPlacingMode] = useState(false);
  const [placeCoords, setPlaceCoords] = useState<{ lat: number; lon: number } | null>(null);
  const statusColors: StatusColorMap = useMemo(
    () => Object.fromEntries(statuses.map((s) => [s.id, s.color])),
    [statuses],
  );

  useEffect(() => registerSyncTriggers(projectId), [projectId]);
  const outboxCount = useOutboxCount(projectId);

  const filtered = useMemo(() => {
    if (activeStatusIds.size === 0) return features;
    return features.filter((f) => f.status_id && activeStatusIds.has(f.status_id));
  }, [features, activeStatusIds]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const userName = currentUser?.displayName?.split(" ")[0] ?? "there";

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        className="z-30 flex h-[60px] items-center gap-2.5 border-b border-[var(--bento-rule)] bg-[var(--bento-surface)] px-3"
        style={{ boxShadow: "var(--bento-shadow-xs)" }}
      >
        <button
          className="bento-focus inline-flex h-9 w-9 items-center justify-center rounded-[12px] text-[var(--bento-ink-2)] transition hover:bg-[var(--bento-surface-3)]"
          aria-label="Back"
          onClick={() => router.push("/home")}
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
        </button>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-2">
            <span
              className="h-7 w-7 flex-shrink-0 rounded-[10px]"
              style={{
                background:
                  "linear-gradient(135deg, var(--bento-accent), var(--bento-magenta))",
              }}
            />
            <div className="min-w-0">
              <h1 className="truncate font-display text-[14px] font-bold text-[var(--bento-ink-1)]">
                Hi, {userName}
              </h1>
              <div className="truncate text-[10.5px] text-[var(--bento-ink-3)]">
                {greeting} · {projectName}
              </div>
            </div>
          </div>
        </div>
        <UserMenu projectId={projectId} user={currentUser ?? null} compact />
      </header>

      <main className="relative flex-1 overflow-hidden bg-[var(--bento-bg)]">
        {tab === "map" && (
          <>
            {/* ── KPI mini-bentos ──────────────────────────────────── */}
            <div className="absolute left-0 right-0 top-0 z-20 grid grid-cols-3 gap-2 px-3 pt-3">
              <MiniKpi
                label="Today"
                value={myStats.today}
                accent="var(--bento-success)"
              />
              <MiniKpi
                label="Total"
                value={myStats.total}
                accent="var(--bento-accent)"
              />
              <MiniKpi
                label="Queue"
                value={outboxCount}
                accent={outboxCount > 0 ? "var(--bento-warning)" : "var(--bento-ink-3)"}
                hint={outboxCount > 0 ? "offline" : "synced"}
              />
            </div>

            {/* ── Map ──────────────────────────────────────────────── */}
            <MaplibreMap
              center={[center.lon, center.lat]}
              zoom={center.zoom ?? 14}
              features={filtered}
              statusColors={statusColors}
              selectedId={selectedPointId}
              onSelect={setSelectedPointId}
              basemap={basemap}
              placingMode={placingMode}
              boundaries={boundaries}
              onPlace={(c) => {
                setPlacingMode(false);
                setPlaceCoords(c);
                setAddOpen(true);
              }}
            />

            {/* ── Placing banner ───────────────────────────────────── */}
            {placingMode && (
              <div
                className="absolute left-1/2 top-[88px] z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border bg-[var(--shell-base-alpha-86)] py-1.5 pl-3.5 pr-1 text-[12px] font-semibold text-[var(--bento-ink-1)] backdrop-blur-[18px]"
                style={{
                  borderColor: "var(--bento-accent)",
                  boxShadow: "var(--bento-shadow-md)",
                }}
              >
                <span
                  className="inline-flex h-2 w-2 rounded-full"
                  style={{
                    background: "var(--bento-accent)",
                    boxShadow: "0 0 10px var(--bento-accent-glow)",
                  }}
                />
                Tap the map to place
                <button
                  onClick={() => setPlacingMode(false)}
                  className="ml-1 inline-flex h-7 items-center justify-center rounded-full bg-[var(--bento-surface-2)] px-2 text-[11px] font-bold text-[var(--bento-ink-2)]"
                  aria-label="Cancel placing"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>
            )}

            {/* ── Basemap chip ─────────────────────────────────────── */}
            <div className="absolute right-3 top-[148px] z-20">
              {basemapOpen && (
                <div
                  className="mb-1 w-[190px] overflow-hidden rounded-[14px] border border-[var(--bento-rule)] bg-[var(--shell-1-alpha-95)] p-1.5 backdrop-blur-[20px]"
                  style={{ boxShadow: "var(--bento-shadow-lg)" }}
                >
                  {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) => {
                    const m = BASEMAPS[k];
                    const on = k === basemap;
                    return (
                      <button
                        key={k}
                        onClick={() => {
                          setBasemap(k);
                          setBasemapOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left ${
                          on
                            ? "text-[var(--bento-ink-1)]"
                            : "text-[var(--bento-ink-2)]"
                        }`}
                        style={on ? { background: "var(--bento-accent-soft)" } : undefined}
                      >
                        <span
                          className="flex h-3.5 w-3.5 items-center justify-center"
                          style={{ color: "var(--bento-accent)" }}
                        >
                          {on && <Check className="h-3 w-3" strokeWidth={2.5} />}
                        </span>
                        <span className="font-display text-[12px] font-bold">{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                onClick={() => setBasemapOpen((o) => !o)}
                aria-label="Choose basemap"
                className="bento-focus inline-flex items-center gap-1.5 rounded-full border border-[var(--bento-rule)] bg-[var(--shell-base-alpha-86)] px-2.5 py-1.5 font-display text-[11px] font-bold text-[var(--bento-ink-2)] backdrop-blur-[14px]"
                style={{ boxShadow: "var(--bento-shadow-sm)" }}
              >
                <Layers className="h-3.5 w-3.5" strokeWidth={1.8} />
                {BASEMAPS[basemap].label}
              </button>
            </div>

            {/* ── Status chip strip (under KPI row) ────────────────── */}
            <div
              className="absolute left-3 right-3 top-[100px] z-20 flex gap-1.5 overflow-x-auto rounded-[16px] border border-[var(--bento-rule)] bg-[var(--shell-base-alpha-86)] p-1.5 backdrop-blur-[20px]"
              style={{ boxShadow: "var(--bento-shadow-sm)" }}
            >
              <button
                onClick={() => setActiveStatusIds(new Set())}
                className={`bento-chip flex-shrink-0 ${
                  activeStatusIds.size === 0 ? "bento-chip-active" : ""
                }`}
              >
                All
              </button>
              {statuses.map((s) => {
                const on = activeStatusIds.has(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      const next = new Set(activeStatusIds);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      setActiveStatusIds(next);
                    }}
                    className="bento-chip flex-shrink-0"
                    style={
                      on
                        ? {
                            background: `${s.color}22`,
                            color: "var(--bento-ink-1)",
                            borderColor: "transparent",
                          }
                        : undefined
                    }
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                    <span className="bento-num font-mono text-[10px] text-[var(--bento-ink-3)]">
                      {s.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* ── FAB ──────────────────────────────────────────────── */}
            <button
              onClick={() => {
                if (placingMode) setPlacingMode(false);
                else setPlacingMode(true);
              }}
              aria-label={placingMode ? "Cancel placing" : "Add point"}
              className="absolute bottom-[80px] right-5 z-20 inline-flex h-14 w-14 items-center justify-center rounded-full transition active:scale-95"
              style={
                placingMode
                  ? {
                      background: "var(--bento-danger)",
                      color: "white",
                      boxShadow:
                        "0 8px 24px -4px oklch(62% 0.18 25 / 0.55), 0 0 0 6px oklch(62% 0.18 25 / 0.12)",
                    }
                  : {
                      background: "var(--bento-accent)",
                      color: "var(--bento-on-accent)",
                      boxShadow:
                        "0 8px 24px -4px oklch(70% 0.14 230 / 0.5), 0 0 0 6px oklch(70% 0.14 230 / 0.14)",
                    }
              }
            >
              {placingMode ? (
                <X className="h-6 w-6" strokeWidth={2.5} />
              ) : (
                <Plus className="h-6 w-6" strokeWidth={2.5} />
              )}
            </button>
          </>
        )}
        {tab === "team" &&
          (currentUserId ? (
            <ChatPanel
              projectId={projectId}
              currentUserId={currentUserId}
              members={chatMembers}
              initial={initialChat}
            />
          ) : (
            <FieldPlaceholder text="Sign in to chat" />
          ))}
        {tab === "more" && (
          <MorePanel
            projectId={projectId}
            projectName={projectName}
            myStats={myStats}
            center={center}
            points={features}
          />
        )}
        {tab === "universe" && canvassMode && (
          <ToVisitList
            projectId={projectId}
            onPick={({ lat, lon }) => {
              setPlaceCoords({ lat, lon });
              setTab("map");
              setAddOpen(true);
            }}
          />
        )}
      </main>

      {/* ── Bottom tab dock ────────────────────────────────────────── */}
      <nav
        className={`z-30 grid h-[62px] ${canvassMode ? "grid-cols-4" : "grid-cols-3"} border-t border-[var(--bento-rule)] bg-[var(--bento-surface)]`}
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
          boxShadow: "var(--bento-shadow-sm)",
        }}
      >
        <TabBtn label="Map" Icon={MapIcon} on={tab === "map"} onClick={() => setTab("map")} />
        {canvassMode && (
          <TabBtn
            label="Visit"
            Icon={ListChecks}
            on={tab === "universe"}
            onClick={() => setTab("universe")}
          />
        )}
        <TabBtn label="Team" Icon={Users} on={tab === "team"} onClick={() => setTab("team")} />
        <TabBtn
          label="More"
          Icon={MoreHorizontal}
          on={tab === "more"}
          onClick={() => setTab("more")}
          badge={outboxCount}
        />
      </nav>

      <MobileAddSheet
        open={addOpen}
        projectId={projectId}
        statuses={statuses}
        initialCoords={placeCoords ?? undefined}
        onClose={() => {
          setAddOpen(false);
          setPlaceCoords(null);
        }}
        onSaved={() => {
          setAddOpen(false);
          setPlaceCoords(null);
          router.refresh();
        }}
      />
      <MobilePointSheet
        pointId={selectedPointId}
        open={!!selectedPointId}
        onClose={() => setSelectedPointId(null)}
        onDeleted={() => router.refresh()}
      />
      <IosInstallBanner />
    </>
  );
}

// ── KPI mini tile (mobile, matches Bento mockup) ────────────────────────────
function MiniKpi({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: number;
  accent: string;
  hint?: string;
}) {
  return (
    <div className="bento-panel relative overflow-hidden p-2.5">
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: accent }}
        />
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[var(--bento-ink-3)]">
          {label}
        </span>
      </div>
      <div
        className="bento-num mt-1 font-display text-[18px] font-extrabold leading-none"
        style={{ color: accent }}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--bento-ink-3)]">
          <Wifi className="h-2.5 w-2.5" strokeWidth={2} />
          {hint}
        </div>
      )}
    </div>
  );
}

function TabBtn({
  label,
  Icon,
  on,
  onClick,
  badge,
}: {
  label: string;
  Icon: typeof MapIcon;
  on: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex flex-col items-center justify-center gap-0.5 transition active:bg-[var(--bento-surface-2)]"
    >
      <Icon
        className="h-5 w-5"
        strokeWidth={1.8}
        style={{
          color: on ? "var(--bento-accent)" : "var(--bento-ink-3)",
        }}
      />
      <span
        className="font-display text-[10px] font-bold"
        style={{
          color: on ? "var(--bento-accent)" : "var(--bento-ink-3)",
        }}
      >
        {label}
      </span>
      {typeof badge === "number" && badge > 0 && (
        <span
          className="absolute right-[18%] top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[9px] font-bold text-white"
          style={{
            background: "var(--bento-warning)",
            border: "2px solid var(--bento-surface)",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function FieldPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-[var(--bento-ink-3)]">
      {text}
    </div>
  );
}
