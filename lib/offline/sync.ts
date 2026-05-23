/**
 * Outbox sync — drains the IndexedDB outbox in order, uploading photos
 * first and then committing the point row via POST /api/points.
 *
 * Replay on:
 *   - window 'online' event
 *   - app foreground (visibilitychange → visible)
 *   - explicit user trigger ("Force sync" in More tab)
 *
 * Exponential backoff: 1s, 5s, 30s, 5m, 30m. Give up after 10 attempts
 * and surface to the sync-queue UI (Keystone pattern).
 */

import { listOutboxPoints, deleteOutboxPoint, getOutboxPhoto, deleteOutboxPhoto, putOutboxPoint, type OutboxPointRow } from "./idb";

const MAX_ATTEMPTS = 10;
const BACKOFF_MS = [1_000, 5_000, 30_000, 300_000, 1_800_000];

let isDraining = false;

export async function drainOutbox(projectId?: string): Promise<{ synced: number; failed: number }> {
  if (isDraining) return { synced: 0, failed: 0 };
  isDraining = true;
  let synced = 0;
  let failed = 0;
  try {
    const rows = await listOutboxPoints(projectId);
    // Sort by collected_at so older work goes first
    rows.sort((a, b) => a.collected_at.localeCompare(b.collected_at));
    for (const row of rows) {
      if (row.attempts >= MAX_ATTEMPTS) continue;
      const backoff = BACKOFF_MS[Math.min(row.attempts, BACKOFF_MS.length - 1)];
      // crude per-row backoff: skip if last_error is recent
      if (row.last_error && Date.now() - row.created_at < backoff && row.attempts > 0) continue;
      try {
        await syncOne(row);
        await deleteOutboxPoint(row.client_id);
        for (const pid of row.photo_blob_ids) await deleteOutboxPhoto(pid);
        synced++;
      } catch (e) {
        failed++;
        await putOutboxPoint({
          ...row,
          attempts: row.attempts + 1,
          last_error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    isDraining = false;
  }
  return { synced, failed };
}

async function syncOne(row: OutboxPointRow): Promise<void> {
  // 1. Upload photos
  const photoPaths: string[] = [];
  for (const photoId of row.photo_blob_ids) {
    const photo = await getOutboxPhoto(photoId);
    if (!photo) continue;
    const form = new FormData();
    form.set("file", photo.blob, `${photoId}.jpg`);
    form.set("project_id", row.project_id);
    form.set("client_point_id", row.client_id);
    const res = await fetch("/api/points/photo-upload", { method: "POST", body: form });
    if (!res.ok) throw new Error(`photo upload ${res.status}`);
    const { path } = (await res.json()) as { path: string };
    photoPaths.push(path);
  }
  // 2. Insert the point
  const res = await fetch("/api/points", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      project_id: row.project_id,
      status_id: row.status_id,
      lat: row.lat,
      lon: row.lon,
      accuracy_m: row.accuracy_m,
      address: row.address,
      notes: row.notes,
      collected_at: row.collected_at,
      client_id: row.client_id,
      is_offline_sync: true,
      photo_paths: photoPaths,
    }),
  });
  if (!res.ok) throw new Error(`point insert ${res.status}`);
}

/** Register sync triggers. Call once from a client component on mount. */
export function registerSyncTriggers(projectId?: string) {
  if (typeof window === "undefined") return () => {};
  const onOnline = () => { void drainOutbox(projectId); };
  const onVisible = () => { if (document.visibilityState === "visible") void drainOutbox(projectId); };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  // Kick off once on mount in case we have stale items
  if (navigator.onLine) void drainOutbox(projectId);
  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
