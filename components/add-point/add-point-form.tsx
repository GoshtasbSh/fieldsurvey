"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, MapPin, Loader2, X } from "lucide-react";
import { newClientId } from "@/lib/client-id";
import { putOutboxPoint, putOutboxPhoto } from "@/lib/offline/idb";
import { drainOutbox } from "@/lib/offline/sync";
import type { StatusRow } from "@/components/desktop/left-rail";

// All blob URLs ever created in this form are tracked so we can revoke
// them on unmount — preventing the Blob backing each File from being
// held in memory after navigation.

type Props = {
  projectId: string;
  statuses: StatusRow[];
  initialLat?: number;
  initialLon?: number;
  onSaved: (result: { online: boolean; pointId?: string; clientId: string }) => void;
  onCancel: () => void;
};

type PhotoLocal = { id: string; blob: Blob; url: string };

/**
 * The shared Add Point form used by both the mobile bottom sheet and the
 * desktop modal. Captures GPS, lets the user override via map drag (caller
 * passes coords back), picks status, takes photos, and submits.
 *
 * Offline-safe: if the network request fails or the browser is offline,
 * the row + photo blobs are queued in IndexedDB and replayed by
 * lib/offline/sync.ts on the next 'online' event.
 */
export function AddPointForm({ projectId, statuses, initialLat, initialLon, onSaved, onCancel }: Props) {
  const [statusId, setStatusId] = useState<string>(statuses.find((s) => s.label.toLowerCase() === "completed")?.id ?? statuses[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<PhotoLocal[]>([]);
  const [coords, setCoords] = useState<{ lat: number; lon: number; accuracy: number | null } | null>(
    initialLat != null && initialLon != null ? { lat: initialLat, lon: initialLon, accuracy: null } : null,
  );
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const activeUrlsRef = useRef<Set<string>>(new Set());

  // Revoke any object URLs still live when the form unmounts
  useEffect(() => {
    const urls = activeUrlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  // GPS watch — high accuracy, single shot if no manual coords given
  useEffect(() => {
    if (coords || initialLat != null) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => setError(err.message),
      { enableHighAccuracy: true, timeout: 8000 },
    );
    return () => { void id; };
  }, [coords, initialLat]);

  // Reverse-geocode address whenever coords change
  useEffect(() => {
    if (!coords) return;
    let cancelled = false;
    (async () => {
      try {
        const url = `/api/geocode?reverse=1&lat=${coords.lat}&lon=${coords.lon}`;
        const r = await fetch(url);
        if (!r.ok) return;
        const j = (await r.json()) as { displayName?: string };
        if (!cancelled && j.displayName) setAddress(j.displayName);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [coords]);

  function onPickPhotos(files: FileList | null) {
    if (!files) return;
    const next: PhotoLocal[] = [];
    for (const f of Array.from(files).slice(0, 8)) {
      const url = URL.createObjectURL(f);
      activeUrlsRef.current.add(url);
      next.push({ id: newClientId(), blob: f, url });
    }
    setPhotos((p) => [...p, ...next].slice(0, 8));
  }

  function removePhoto(id: string) {
    setPhotos((p) => {
      const target = p.find((x) => x.id === id);
      if (target) {
        URL.revokeObjectURL(target.url);
        activeUrlsRef.current.delete(target.url);
      }
      return p.filter((x) => x.id !== id);
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!coords || !statusId) {
      setError("Need GPS coordinates and a status.");
      return;
    }
    setBusy(true);
    const clientId = newClientId();
    const collectedAt = new Date().toISOString();

    // Queue photos to IDB first so the outbox can replay them
    const photoIds = photos.map((p) => p.id);
    for (const p of photos) {
      await putOutboxPhoto({ id: p.id, blob: p.blob, mime: p.blob.type || "image/jpeg" });
    }

    // Always write to outbox so the row survives a network failure mid-request
    await putOutboxPoint({
      client_id: clientId,
      project_id: projectId,
      status_id: statusId,
      lat: coords.lat,
      lon: coords.lon,
      accuracy_m: coords.accuracy,
      address: address || null,
      notes: notes || null,
      collected_at: collectedAt,
      photo_blob_ids: photoIds,
      attempts: 0,
      last_error: null,
      created_at: Date.now(),
    });

    // Try the live drain immediately — if online, this commits the row
    let online = false;
    let pointId: string | undefined;
    try {
      const r = await drainOutbox(projectId);
      online = r.synced > 0;
    } catch {
      online = false;
    }
    setBusy(false);
    onSaved({ online, pointId, clientId });
  }

  return (
    <form onSubmit={onSubmit} className="flex h-full flex-col gap-3.5 overflow-y-auto p-4">
      {/* GPS coord display */}
      <div className="rounded-xl border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] p-3">
        <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.07em] text-[oklch(58%_0.014_250)]">
          <MapPin className="h-3 w-3 text-[oklch(78%_0.155_234)]" strokeWidth={1.7} />
          GPS · {coords?.accuracy != null ? `±${coords.accuracy.toFixed(1)}m` : "locating…"}
        </div>
        <div className="mt-1 font-mono text-[12px] tabular-nums text-[oklch(96%_0.008_250)]">
          {coords ? `${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}` : "—"}
        </div>
        {address && <div className="mt-1 text-[11px] italic text-[oklch(76%_0.012_250)]">{address}</div>}
      </div>

      {/* Status grid */}
      <div>
        <label className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.07em] text-[oklch(58%_0.014_250)]">Status</label>
        <div className="grid grid-cols-3 gap-1.5">
          {statuses.map((s) => {
            const on = statusId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setStatusId(s.id)}
                className={`flex flex-col items-center gap-1 rounded-lg border p-2.5 text-[10.5px] font-bold transition ${
                  on
                    ? "border-[oklch(78%_0.155_234/0.32)] bg-[oklch(78%_0.155_234/0.16)] text-[oklch(96%_0.008_250)]"
                    : "border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] text-[oklch(76%_0.012_250)] hover:border-[oklch(36%_0.025_250/0.7)]"
                }`}
                style={on ? { boxShadow: `0 0 0 1px ${s.color}55` } : undefined}
              >
                <span className="h-3 w-3 rounded-full ring-2 ring-[oklch(14%_0.012_250)]" style={{ background: s.color }} />
                <span className="text-center leading-tight">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="notes" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.07em] text-[oklch(58%_0.014_250)]">
          Notes <span className="font-normal lowercase">optional</span>
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder='e.g. "Gate locked, return Thu PM"'
          className="w-full resize-none rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] px-3 py-2 text-[13px] text-[oklch(96%_0.008_250)] outline-none placeholder:text-[oklch(58%_0.014_250)] focus:border-[oklch(78%_0.155_234/0.6)]"
        />
      </div>

      {/* Photos */}
      <div>
        <label className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.07em] text-[oklch(58%_0.014_250)]">Photos</label>
        <div className="grid grid-cols-4 gap-1.5">
          {photos.map((p) => (
            <div key={p.id} className="relative aspect-square overflow-hidden rounded-md border border-[oklch(28%_0.02_250/0.55)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(p.id)}
                className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[oklch(14%_0.012_250/0.85)] text-[oklch(96%_0.008_250)]"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            </div>
          ))}
          {photos.length < 8 && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="aspect-square rounded-md border border-dashed border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] text-[oklch(76%_0.012_250)] hover:border-[oklch(78%_0.155_234/0.5)] hover:text-[oklch(78%_0.155_234)] inline-flex items-center justify-center"
            >
              <Camera className="h-4 w-4" strokeWidth={1.7} />
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => onPickPhotos(e.target.files)}
        />
      </div>

      {error && <p className="text-[11.5px] text-[oklch(68%_0.21_25)]">{error}</p>}

      {/* Actions */}
      <div className="mt-auto flex gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] py-2.5 font-display text-[12px] font-bold text-[oklch(76%_0.012_250)] hover:bg-[oklch(24%_0.018_250)] hover:text-[oklch(96%_0.008_250)] transition"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !coords || !statusId}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[oklch(78%_0.155_234)] py-2.5 font-display text-[12px] font-bold text-[oklch(14%_0.012_250)] shadow-[0_4px_14px_oklch(78%_0.155_234/0.4),inset_0_1px_0_oklch(100%_0_0/0.3)] hover:bg-[oklch(82%_0.16_234)] disabled:opacity-50 transition"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
          {busy ? "Saving…" : "Save point"}
        </button>
      </div>
    </form>
  );
}
