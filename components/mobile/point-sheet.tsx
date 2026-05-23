"use client";

import { useEffect, useState } from "react";
import { X, Edit2, Trash2, MapPin as MapPinIcon } from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase/client";

type PointDetail = {
  id: string;
  status_id: string;
  status_label: string;
  status_color: string;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  address: string | null;
  notes: string | null;
  collector_name: string | null;
  collected_at: string;
};

/**
 * Mobile bottom sheet shown when the surveyor taps a pin on the map.
 * NO survey-response data (per project_fieldsurvey_mobile_scope memory).
 * Only the field collection info: status, address, notes, photos, GPS.
 */
export function MobilePointSheet({ pointId, open, onClose, onDeleted }: { pointId: string | null; open: boolean; onClose: () => void; onDeleted: () => void }) {
  const [data, setData] = useState<PointDetail | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !pointId) return;
    setData(null);
    void (async () => {
      const sb = createBrowserSupabase();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row } = await (sb.from("points") as any)
        .select("id, status_id, lat, lon, accuracy_m, address, notes, collected_at, project_statuses(label, color), profiles!points_collector_id_fkey(display_name, email)")
        .eq("id", pointId)
        .maybeSingle();
      if (row) {
        setData({
          id: row.id,
          status_id: row.status_id,
          status_label: row.project_statuses?.label ?? "Unknown",
          status_color: row.project_statuses?.color ?? "#9ca3af",
          lat: row.lat, lon: row.lon, accuracy_m: row.accuracy_m,
          address: row.address, notes: row.notes,
          collected_at: row.collected_at,
          collector_name: row.profiles?.display_name ?? row.profiles?.email?.split("@")[0] ?? null,
        });
      }
    })();
  }, [open, pointId]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  async function onDelete() {
    if (!data) return;
    if (!confirm("Delete this point? This cannot be undone.")) return;
    setBusy(true);
    const sb = createBrowserSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (sb.from("points") as any).delete().eq("id", data.id);
    setBusy(false);
    if (error) { alert(error.message); return; }
    onDeleted();
    onClose();
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[oklch(0%_0_0/0.6)] backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-hidden rounded-t-2xl border-t border-[oklch(28%_0.02_250/0.55)] bg-[oklch(17%_0.014_250)] shadow-[0_-12px_40px_-8px_oklch(0%_0_0/0.6)]" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex justify-center py-2"><span className="h-1 w-10 rounded-full bg-[oklch(36%_0.025_250/0.7)]" /></div>
        <div className="flex items-center justify-between px-4 pb-2">
          <h2 className="font-display text-[15px] font-extrabold">Point</h2>
          <button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[oklch(76%_0.012_250)] hover:bg-[oklch(20%_0.016_250)]"><X className="h-4 w-4" strokeWidth={1.7} /></button>
        </div>

        {!data ? (
          <div className="p-4 text-center text-[12px] text-[oklch(58%_0.014_250)]">Loading…</div>
        ) : (
          <div className="space-y-3 px-4 pb-4">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full ring-2 ring-[oklch(14%_0.012_250)]" style={{ background: data.status_color }} />
              <span className="font-display text-[14px] font-bold">{data.status_label}</span>
            </div>
            {data.address && (
              <div className="flex items-start gap-2 rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] p-3">
                <MapPinIcon className="h-4 w-4 mt-0.5 text-[oklch(78%_0.155_234)]" strokeWidth={1.7} />
                <span className="text-[13px]">{data.address}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Coordinates" value={`${data.lat.toFixed(5)}, ${data.lon.toFixed(5)}`} mono />
              <Field label="Accuracy" value={data.accuracy_m != null ? `±${data.accuracy_m.toFixed(1)} m` : "—"} mono />
              <Field label="Collected by" value={data.collector_name ?? "Unknown"} />
              <Field label="When" value={new Date(data.collected_at).toLocaleString()} mono />
            </div>
            {data.notes && (
              <div className="rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] p-3">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-[oklch(58%_0.014_250)]">Notes</div>
                <p className="mt-1 text-[12.5px]">{data.notes}</p>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button disabled={busy} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] py-2.5 font-display text-[12px] font-bold text-[oklch(76%_0.012_250)] disabled:opacity-50"><Edit2 className="h-3.5 w-3.5" strokeWidth={1.7} /> Edit</button>
              <button onClick={onDelete} disabled={busy} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[oklch(68%_0.21_25/0.3)] bg-[oklch(68%_0.21_25/0.1)] py-2.5 font-display text-[12px] font-bold text-[oklch(68%_0.21_25)] disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} /> Delete</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] p-2.5">
      <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-[oklch(58%_0.014_250)]">{label}</div>
      <div className={`mt-0.5 text-[12px] ${mono ? "font-mono tabular-nums" : ""}`}>{value}</div>
    </div>
  );
}
