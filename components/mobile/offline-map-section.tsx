"use client";

import { useState } from "react";
import { Download, CheckCircle2, AlertCircle } from "lucide-react";
import { metersBoundingBox, tilesForBox, preCacheTiles } from "@/lib/offline/tile-cache";

const DEFAULT_RADIUS_M = 5000; // ~10km square
const Z_MIN = 12;
const Z_MAX = 16;

export function OfflineMapSection({ center }: { center: { lat: number; lon: number } }) {
  const [state, setState] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [err, setErr] = useState<string | null>(null);

  const box = metersBoundingBox(center.lat, center.lon, DEFAULT_RADIUS_M);
  const tiles = tilesForBox(box, Z_MIN, Z_MAX);

  async function download() {
    setState("downloading"); setProgress({ done: 0, total: tiles.length }); setErr(null);
    try {
      await preCacheTiles(tiles, (p) => setProgress(p));
      setState("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const estMB = (tiles.length * 0.025).toFixed(1); // ~25 KB / tile average

  return (
    <div className="rounded-xl border border-[var(--shell-border)] bg-[var(--shell-1)] p-3.5">
      <div className="flex items-center gap-2">
        <Download className="h-4 w-4 text-[oklch(78%_0.155_234)]" strokeWidth={1.7} />
        <h3 className="font-display text-[13px] font-extrabold">Download offline map</h3>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--shell-text-2)]">
        Pre-cache the ~10 km square around your project so the map renders without a network. Approx <b>{estMB} MB</b> ({tiles.length.toLocaleString()} tiles · zooms {Z_MIN}–{Z_MAX}).
      </p>

      {state === "idle" && (
        <button onClick={download} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[oklch(78%_0.155_234)] px-3 py-2 font-display text-[12px] font-bold text-[var(--shell-base)] shadow-[0_4px_14px_oklch(78%_0.155_234/0.4)] active:scale-95">
          <Download className="h-3.5 w-3.5" strokeWidth={2} /> Download tiles
        </button>
      )}

      {state === "downloading" && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between font-mono text-[10.5px] text-[var(--shell-text-2)] tabular-nums">
            <span>{progress.done} / {progress.total} tiles</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--shell-3)]">
            <div className="h-full bg-[oklch(78%_0.155_234)] transition-[width] duration-150" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {state === "done" && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[oklch(76%_0.16_158/0.12)] px-3 py-2 text-[11.5px] font-bold text-[oklch(76%_0.16_158)]">
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.7} /> Cached. Safe to fly.
        </div>
      )}

      {state === "error" && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[oklch(68%_0.21_25/0.12)] px-3 py-2 text-[11.5px] font-bold text-[oklch(68%_0.21_25)]">
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.7} /> {err ?? "Download failed"}
        </div>
      )}
    </div>
  );
}
