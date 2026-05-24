"use client";

import { useEffect, useState } from "react";
import { CloudUpload, AlertTriangle, RefreshCw, Trash2, Wifi, WifiOff } from "lucide-react";
import { listOutboxPoints, deleteOutboxPoint, deleteOutboxPhoto, type OutboxPointRow } from "@/lib/offline/idb";
import { drainOutbox } from "@/lib/offline/sync";

/**
 * Mobile Sync Queue — shows pending and failed outbox items.
 * Lists oldest first. Per-row: Retry / Discard. Top: Force sync all.
 * Ported from keystone_field_web/index.html Sync Queue UI.
 */
export function SyncQueuePanel({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<OutboxPointRow[]>([]);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await listOutboxPoints(projectId);
    setRows(r.sort((a, b) => a.collected_at.localeCompare(b.collected_at)));
  }

  useEffect(() => {
    void refresh();
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const id = setInterval(() => void refresh(), 5_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function forceSync() {
    setBusy(true);
    try {
      await drainOutbox(projectId);
      await refresh();
    } finally { setBusy(false); }
  }

  async function discard(row: OutboxPointRow) {
    if (!confirm("Discard this point? This cannot be undone.")) return;
    for (const id of row.photo_blob_ids) await deleteOutboxPhoto(id);
    await deleteOutboxPoint(row.client_id);
    await refresh();
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2 rounded-lg border border-[var(--shell-border)] bg-[var(--shell-2)] p-3">
        {online ? <Wifi className="h-4 w-4 text-[oklch(76%_0.16_158)]" strokeWidth={1.7} /> : <WifiOff className="h-4 w-4 text-[oklch(82%_0.17_86)]" strokeWidth={1.7} />}
        <span className="flex-1 text-[12.5px] font-semibold">
          {online ? "Online" : "Offline"} · <span className="font-mono">{rows.length}</span> queued
        </span>
        <button
          onClick={forceSync}
          disabled={busy || rows.length === 0 || !online}
          className="inline-flex items-center gap-1.5 rounded-md bg-[oklch(78%_0.155_234)] px-3 py-1.5 font-display text-[11px] font-bold text-[var(--shell-base)] disabled:opacity-50"
        >
          <CloudUpload className="h-3.5 w-3.5" strokeWidth={2} />
          {busy ? "Syncing…" : "Force sync"}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-[12px] text-[var(--shell-text-muted)] py-8">All synced. No pending points.</p>
      ) : (
        rows.map((r) => (
          <div key={r.client_id} className="rounded-lg border border-[var(--shell-border)] bg-[var(--shell-1)] p-3">
            <div className="flex items-center justify-between">
              <span className="font-display text-[12.5px] font-bold">{r.address ?? `${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}`}</span>
              <span className="font-mono text-[10px] text-[var(--shell-text-muted)]">{relativeTime(r.collected_at)}</span>
            </div>
            {r.notes && <p className="mt-1 text-[11.5px] text-[var(--shell-text-2)]">{r.notes}</p>}
            {r.last_error && (
              <div className="mt-2 flex items-start gap-1.5 rounded border border-[oklch(86%_0.18_88/0.3)] bg-[oklch(86%_0.18_88/0.08)] p-2 text-[10.5px] text-[oklch(82%_0.17_86)]">
                <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" strokeWidth={1.7} />
                <span>Attempt {r.attempts}/10 — {r.last_error}</span>
              </div>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => discard(r)} className="inline-flex items-center gap-1 rounded border border-[oklch(68%_0.21_25/0.3)] px-2 py-1 text-[10.5px] font-bold text-[oklch(68%_0.21_25)] hover:bg-[oklch(68%_0.21_25/0.1)]">
                <Trash2 className="h-3 w-3" strokeWidth={1.7} /> Discard
              </button>
              <button onClick={forceSync} disabled={busy || !online} className="inline-flex items-center gap-1 rounded bg-[oklch(78%_0.155_234)] px-2 py-1 text-[10.5px] font-bold text-[var(--shell-base)] disabled:opacity-50">
                <RefreshCw className="h-3 w-3" strokeWidth={1.7} /> Retry
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function relativeTime(iso: string): string {
  const t = Date.now() - new Date(iso).getTime();
  if (t < 60_000) return "just now";
  if (t < 3_600_000) return `${Math.floor(t / 60_000)}m ago`;
  if (t < 86_400_000) return `${Math.floor(t / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Used by the tab-bar badge: returns the current outbox length for the project. */
export function useOutboxCount(projectId: string): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let active = true;
    const tick = async () => {
      const rows = await listOutboxPoints(projectId);
      if (active) setN(rows.length);
    };
    void tick();
    const id = setInterval(() => void tick(), 5_000);
    return () => { active = false; clearInterval(id); };
  }, [projectId]);
  return n;
}
