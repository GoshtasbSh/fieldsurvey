"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Map as MapIcon, Users, MoreHorizontal, ChevronLeft } from "lucide-react";
import type { StatusRow } from "@/components/desktop/left-rail";
import type { StatusColorMap } from "@/components/map/maplibre-map";
import { MobileAddSheet } from "@/components/mobile/add-sheet";
import { registerSyncTriggers } from "@/lib/offline/sync";

const MaplibreMap = dynamic(() => import("@/components/map/maplibre-map").then((m) => m.MaplibreMap), { ssr: false });

type Props = {
  projectId: string;
  projectName: string;
  center: { lat: number; lon: number; zoom: number };
  statuses: StatusRow[];
};

export function MobileFieldShell({ projectId, projectName, center, statuses }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"map" | "team" | "more">("map");
  const [activeStatusIds, setActiveStatusIds] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const statusColors: StatusColorMap = useMemo(() => Object.fromEntries(statuses.map((s) => [s.id, s.color])), [statuses]);

  useEffect(() => registerSyncTriggers(projectId), [projectId]);

  return (
    <>
      <header className="z-30 flex h-12 items-center gap-2 border-b border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)] px-3">
        <button className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[oklch(76%_0.012_250)] hover:bg-[oklch(20%_0.016_250)]" aria-label="Back" onClick={() => router.push("/home")}>
          <ChevronLeft className="h-5 w-5" strokeWidth={1.7} />
        </button>
        <h1 className="flex-1 truncate font-display text-[14px] font-extrabold tracking-tight">{projectName}</h1>
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[oklch(28%_0.02_250/0.55)] bg-gradient-to-br from-[oklch(72%_0.18_305)] to-[oklch(78%_0.155_234)] text-[11px] font-bold text-[oklch(14%_0.012_250)]">
          GS
        </div>
      </header>

      <main className="relative flex-1 overflow-hidden">
        {tab === "map" && (
          <>
            <MaplibreMap center={[center.lon, center.lat]} zoom={center.zoom ?? 14} features={[]} statusColors={statusColors} selectedId={null} onSelect={() => {}} />
            <div className="absolute left-2 right-2 top-2 z-20 flex gap-1.5 overflow-x-auto rounded-2xl border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(14%_0.012_250/0.78)] p-1.5 backdrop-blur-[20px]">
              <button
                onClick={() => setActiveStatusIds(new Set())}
                className={`flex-shrink-0 rounded-xl px-3 py-1.5 font-display text-[11px] font-bold transition ${activeStatusIds.size === 0 ? "bg-[oklch(78%_0.155_234/0.18)] text-[oklch(78%_0.155_234)]" : "text-[oklch(76%_0.012_250)]"}`}
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
                    className={`flex-shrink-0 inline-flex items-center gap-2 rounded-xl px-3 py-1.5 font-display text-[11px] font-bold transition ${on ? "text-[oklch(96%_0.008_250)]" : "text-[oklch(76%_0.012_250)] hover:text-[oklch(96%_0.008_250)]"}`}
                    style={on ? { background: `${s.color}26` } : undefined}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                    <span className="font-mono text-[10px] tabular-nums text-[oklch(58%_0.014_250)]">{s.count}</span>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setAddOpen(true)}
              aria-label="Add point"
              className="absolute bottom-[80px] right-5 z-20 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[oklch(78%_0.155_234)] text-[oklch(14%_0.012_250)] shadow-[0_8px_24px_-4px_oklch(78%_0.155_234/0.55),0_0_0_6px_oklch(78%_0.155_234/0.12),inset_0_1px_0_oklch(100%_0_0/0.35)] active:scale-95 transition"
            >
              <Plus className="h-6 w-6" strokeWidth={2.5} />
            </button>
          </>
        )}
        {tab === "team" && <FieldPlaceholder text="Team activity + chat — coming next slice" />}
        {tab === "more" && <FieldPlaceholder text="Sync queue · My points · Switch view · Sign out" />}
      </main>

      <nav className="z-30 grid h-[58px] grid-cols-3 border-t border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)]" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <TabBtn label="Map" Icon={MapIcon} on={tab === "map"} onClick={() => setTab("map")} />
        <TabBtn label="Team" Icon={Users} on={tab === "team"} onClick={() => setTab("team")} />
        <TabBtn label="More" Icon={MoreHorizontal} on={tab === "more"} onClick={() => setTab("more")} />
      </nav>

      <MobileAddSheet
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

function TabBtn({ label, Icon, on, onClick }: { label: string; Icon: typeof MapIcon; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-0.5 active:bg-[oklch(20%_0.016_250)]">
      <Icon className={`h-5 w-5 ${on ? "text-[oklch(78%_0.155_234)]" : "text-[oklch(58%_0.014_250)]"}`} strokeWidth={1.7} />
      <span className={`font-display text-[10px] font-bold ${on ? "text-[oklch(78%_0.155_234)]" : "text-[oklch(58%_0.014_250)]"}`}>{label}</span>
    </button>
  );
}

function FieldPlaceholder({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-[oklch(58%_0.014_250)]">{text}</div>;
}
