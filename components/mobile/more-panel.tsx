"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Monitor, LogOut, MapPin, CloudUpload } from "lucide-react";
import { SyncQueuePanel } from "@/components/mobile/sync-queue-panel";
import { OfflineMapSection } from "@/components/mobile/offline-map-section";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { DEVICE_PREF_COOKIE } from "@/lib/device.client";

type MoreTab = "menu" | "queue" | "mypoints";
type MyPointSummary = { today: number; total: number };

export function MorePanel({ projectId, projectName, myStats, center }: { projectId: string; projectName: string; myStats: MyPointSummary; center: { lat: number; lon: number } }) {
  const router = useRouter();
  const [view, setView] = useState<MoreTab>("menu");

  async function signOut() {
    const sb = createBrowserSupabase();
    await sb.auth.signOut();
    router.push("/sign-in");
  }

  function switchToDesktop() {
    document.cookie = `${DEVICE_PREF_COOKIE}=desktop; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    router.push(`/p/${projectId}/map`);
  }

  if (view === "queue") return (
    <>
      <PanelHeader title="Sync queue" onBack={() => setView("menu")} />
      <SyncQueuePanel projectId={projectId} />
    </>
  );

  if (view === "mypoints") return (
    <>
      <PanelHeader title="My points" onBack={() => setView("menu")} />
      <div className="p-4 space-y-3">
        <StatTile label="Today" value={String(myStats.today)} />
        <StatTile label="All time" value={String(myStats.total)} />
        <p className="text-[11px] text-[var(--shell-text-muted)]">Tap the Map tab to see them plotted.</p>
      </div>
    </>
  );

  return (
    <div className="p-4 space-y-2">
      <div className="rounded-xl border border-[var(--shell-border)] bg-[var(--shell-1)] p-4">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[var(--shell-text-muted)]">Project</div>
        <div className="mt-1 font-display text-[14px] font-extrabold">{projectName}</div>
      </div>

      <MenuRow Icon={CloudUpload} label="Sync queue" desc="Pending and failed offline points" onClick={() => setView("queue")} />
      <MenuRow Icon={MapPin}      label="My points" desc={`${myStats.today} today · ${myStats.total} total`} onClick={() => setView("mypoints")} />
      <OfflineMapSection center={center} />
      <MenuRow Icon={Monitor}     label="Switch to desktop" desc="Open the full dashboard" onClick={switchToDesktop} />
      <MenuRow Icon={LogOut}      label="Sign out" desc="" onClick={signOut} tone="danger" />
    </div>
  );
}

function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--shell-border)] bg-[var(--shell-1)] px-3 py-2.5">
      <button onClick={onBack} className="inline-flex h-8 px-2 items-center justify-center rounded text-[var(--shell-text-2)] hover:bg-[var(--shell-2)] text-[12px] font-semibold">← Back</button>
      <h2 className="flex-1 text-center font-display text-[13px] font-extrabold pr-12">{title}</h2>
    </div>
  );
}

function MenuRow({ Icon, label, desc, onClick, tone }: { Icon: typeof Monitor; label: string; desc: string; onClick: () => void; tone?: "danger" }) {
  const labelCls = tone === "danger" ? "text-[oklch(68%_0.21_25)]" : "text-[var(--shell-text)]";
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-[var(--shell-border)] bg-[var(--shell-1)] p-3 text-left active:bg-[var(--shell-2)]">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--shell-2)]">
        <Icon className={`h-4 w-4 ${tone === "danger" ? "text-[oklch(68%_0.21_25)]" : "text-[oklch(78%_0.155_234)]"}`} strokeWidth={1.7} />
      </span>
      <div className="flex-1">
        <div className={`font-display text-[13px] font-bold ${labelCls}`}>{label}</div>
        {desc && <div className="text-[11px] text-[var(--shell-text-muted)]">{desc}</div>}
      </div>
      <span className="text-[var(--shell-text-muted)] text-[14px]">›</span>
    </button>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--shell-border)] bg-[var(--shell-1)] p-3">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[var(--shell-text-muted)]">{label}</div>
      <div className="mt-1 font-display text-[24px] font-extrabold tabular-nums">{value}</div>
    </div>
  );
}
