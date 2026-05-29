"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  MapPin,
  CloudUpload,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { SyncQueuePanel } from "@/components/mobile/sync-queue-panel";
import { OfflineMapSection } from "@/components/mobile/offline-map-section";
import { createBrowserSupabase } from "@/lib/supabase/client";

type MoreTab = "menu" | "queue" | "mypoints";
type MyPointSummary = { today: number; total: number };

export function MorePanel({
  projectId,
  projectName,
  myStats,
  center,
  points = [],
}: {
  projectId: string;
  projectName: string;
  myStats: MyPointSummary;
  center: { lat: number; lon: number };
  /** Surveyor's recent points; used for tile-precache bbox (KeyStone §10). */
  points?: Array<{ lat: number; lon: number } | null | undefined>;
}) {
  const router = useRouter();
  const [view, setView] = useState<MoreTab>("menu");

  async function signOut() {
    const sb = createBrowserSupabase();
    await sb.auth.signOut();
    router.push("/sign-in");
  }

  if (view === "queue")
    return (
      <>
        <PanelHeader title="Sync queue" onBack={() => setView("menu")} />
        <SyncQueuePanel projectId={projectId} />
      </>
    );

  if (view === "mypoints")
    return (
      <>
        <PanelHeader title="My points" onBack={() => setView("menu")} />
        <div className="space-y-3 p-4">
          <StatTile label="Today" value={String(myStats.today)} />
          <StatTile label="All time" value={String(myStats.total)} />
          <p className="text-[11px] text-[var(--bento-ink-3)]">
            Tap the Map tab to see them plotted.
          </p>
        </div>
      </>
    );

  return (
    <div className="space-y-2 bg-[var(--bento-bg)] p-4">
      {/* Project hero */}
      <div className="bento-panel relative overflow-hidden p-4">
        <div
          className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full"
          style={{ background: "var(--bento-accent-soft)" }}
        />
        <div className="relative">
          <div className="bento-label">Project</div>
          <div className="mt-1 font-display text-[15px] font-bold text-[var(--bento-ink-1)]">
            {projectName}
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-[var(--bento-ink-3)]">
            {myStats.today} visits today · {myStats.total} all time
          </div>
        </div>
      </div>

      <MenuRow
        Icon={CloudUpload}
        label="Sync queue"
        desc="Pending and failed offline points"
        onClick={() => setView("queue")}
      />
      <MenuRow
        Icon={MapPin}
        label="My points"
        desc={`${myStats.today} today · ${myStats.total} total`}
        onClick={() => setView("mypoints")}
      />

      <ExportMyDataRow projectId={projectId} />

      <OfflineMapSection center={center} points={points} />

      <MenuRow Icon={LogOut} label="Sign out" desc="" onClick={signOut} tone="danger" />
    </div>
  );
}

// ── Export my data — POSTs to /api/export/my-data, surveyor receives a
//    CSV email with 7-day signed photo URLs. Throttled 1/hour at the API.
function ExportMyDataRow({ projectId }: { projectId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function go() {
    setState("loading");
    setMsg(null);
    try {
      const res = await fetch("/api/export/my-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(body?.error || `Export failed (${res.status})`);
        setState("error");
        return;
      }
      setMsg(body?.message || "Sent to your email.");
      setState("done");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  return (
    <button
      onClick={go}
      disabled={state === "loading"}
      className="bento-panel flex w-full items-center gap-3 p-3 text-left transition active:bg-[var(--bento-surface-2)] disabled:opacity-60"
    >
      <span
        className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[12px]"
        style={{
          background: "var(--bento-accent-soft)",
          color: "var(--bento-accent)",
        }}
      >
        {state === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        ) : state === "done" ? (
          <CheckCircle2 className="h-4 w-4" style={{ color: "var(--bento-success)" }} strokeWidth={2} />
        ) : state === "error" ? (
          <AlertCircle className="h-4 w-4" style={{ color: "var(--bento-danger)" }} strokeWidth={2} />
        ) : (
          <Download className="h-4 w-4" strokeWidth={2} />
        )}
      </span>
      <div className="flex-1">
        <div className="font-display text-[13px] font-bold text-[var(--bento-ink-1)]">
          Export my data
        </div>
        <div className="text-[11px] text-[var(--bento-ink-3)]">
          {state === "done"
            ? msg ?? "Check your email."
            : state === "error"
              ? msg ?? "Try again in a moment."
              : "Emails you a CSV of your points + 7-day signed photo URLs."}
        </div>
      </div>
      <span className="text-[14px] text-[var(--bento-ink-3)]">›</span>
    </button>
  );
}

function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div
      className="flex items-center gap-2 border-b border-[var(--bento-rule)] bg-[var(--bento-surface)] px-3 py-2.5"
      style={{ boxShadow: "var(--bento-shadow-xs)" }}
    >
      <button
        onClick={onBack}
        className="inline-flex h-8 items-center justify-center rounded-[8px] px-2 text-[12px] font-semibold text-[var(--bento-ink-2)] transition hover:bg-[var(--bento-surface-3)] hover:text-[var(--bento-ink-1)]"
      >
        ← Back
      </button>
      <h2 className="flex-1 pr-12 text-center font-display text-[13px] font-bold text-[var(--bento-ink-1)]">
        {title}
      </h2>
    </div>
  );
}

function MenuRow({
  Icon,
  label,
  desc,
  onClick,
  tone,
}: {
  Icon: typeof LogOut;
  label: string;
  desc: string;
  onClick: () => void;
  tone?: "danger";
}) {
  const iconBg =
    tone === "danger" ? "var(--bento-danger-soft)" : "var(--bento-accent-soft)";
  const iconColor =
    tone === "danger" ? "var(--bento-danger)" : "var(--bento-accent)";
  const labelColor =
    tone === "danger" ? "var(--bento-danger)" : "var(--bento-ink-1)";
  return (
    <button
      onClick={onClick}
      className="bento-panel flex w-full items-center gap-3 p-3 text-left transition active:bg-[var(--bento-surface-2)]"
    >
      <span
        className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[12px]"
        style={{ background: iconBg, color: iconColor }}
      >
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </span>
      <div className="flex-1">
        <div
          className="font-display text-[13px] font-bold"
          style={{ color: labelColor }}
        >
          {label}
        </div>
        {desc && (
          <div className="text-[11px] text-[var(--bento-ink-3)]">{desc}</div>
        )}
      </div>
      <span className="text-[14px] text-[var(--bento-ink-3)]">›</span>
    </button>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bento-panel p-3">
      <div className="bento-label">{label}</div>
      <div className="bento-num mt-1 font-display text-[24px] font-extrabold text-[var(--bento-ink-1)]">
        {value}
      </div>
    </div>
  );
}
