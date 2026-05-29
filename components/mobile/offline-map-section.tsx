"use client";

import { useMemo, useState } from "react";
import { Download, CheckCircle2, AlertCircle } from "lucide-react";
import {
  metersBoundingBox,
  bboxFromPoints,
  tilesForBox,
  preCacheTiles,
} from "@/lib/offline/tile-cache";

const FALLBACK_RADIUS_M = 5000; // ~10km square — used only when there are no points yet
const Z_MIN = 12;
const Z_MAX = 16;

type Point = { lat: number; lon: number } | null | undefined;

/**
 * Pre-cache the tiles for the surveyor's actual working area.
 *
 * KeyStone §10 lesson: bbox must derive from ACTUAL point data, not a
 * fixed radius around `project.center` (which can be off by many km from
 * where the field team is actually working). We pass the recent points
 * down from the field shell; if there are <2 points we fall back to the
 * radius so an empty project still gets a usable cache.
 */
export function OfflineMapSection({
  center,
  points = [],
}: {
  center: { lat: number; lon: number };
  points?: Point[];
}) {
  const [state, setState] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [err, setErr] = useState<string | null>(null);

  const { box, source } = useMemo(() => {
    const fromPoints = bboxFromPoints(points);
    if (fromPoints) return { box: fromPoints, source: "points" as const };
    return {
      box: metersBoundingBox(center.lat, center.lon, FALLBACK_RADIUS_M),
      source: "center" as const,
    };
  }, [points, center.lat, center.lon]);

  const tiles = useMemo(() => tilesForBox(box, Z_MIN, Z_MAX), [box]);

  async function download() {
    setState("downloading");
    setProgress({ done: 0, total: tiles.length });
    setErr(null);
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
  const pointCount = points.filter((p): p is { lat: number; lon: number } => Boolean(p)).length;

  return (
    <div className="bento-panel p-4">
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-[10px]"
          style={{
            background: "var(--bento-accent-soft)",
            color: "var(--bento-accent)",
          }}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <h3 className="font-display text-[13px] font-bold text-[var(--bento-ink-1)]">
          Download offline map
        </h3>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--bento-ink-2)]">
        {source === "points" ? (
          <>
            Pre-cache the area around your <b>{pointCount}</b> existing points so the map renders without a network. Approx{" "}
            <b>{estMB} MB</b> ({tiles.length.toLocaleString()} tiles · zooms {Z_MIN}–{Z_MAX}).
          </>
        ) : (
          <>
            Pre-cache the ~10 km square around your project so the map renders without a network. Approx{" "}
            <b>{estMB} MB</b> ({tiles.length.toLocaleString()} tiles · zooms {Z_MIN}–{Z_MAX}).
            <br />
            <span className="text-[var(--bento-ink-3)]">
              Add a few field points first and the cache will scope to your actual working area.
            </span>
          </>
        )}
      </p>

      {state === "idle" && (
        <button
          onClick={download}
          className="bento-focus mt-3 inline-flex items-center gap-2 rounded-[12px] px-3 py-2 font-display text-[12px] font-bold transition active:scale-95"
          style={{
            background: "var(--bento-accent)",
            color: "var(--bento-on-accent)",
            boxShadow: "var(--bento-shadow-accent)",
          }}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2} /> Download tiles
        </button>
      )}

      {state === "downloading" && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between bento-num font-mono text-[10.5px] text-[var(--bento-ink-2)]">
            <span>
              {progress.done} / {progress.total} tiles
            </span>
            <span>{pct}%</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full"
            style={{ background: "var(--bento-rule)" }}
          >
            <div
              className="h-full transition-[width] duration-150"
              style={{ width: `${pct}%`, background: "var(--bento-accent)" }}
            />
          </div>
        </div>
      )}

      {state === "done" && (
        <div
          className="mt-3 inline-flex items-center gap-2 rounded-[10px] px-3 py-2 text-[11.5px] font-bold"
          style={{
            background: "var(--bento-success-soft)",
            color: "var(--bento-success)",
          }}
        >
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.8} /> Cached. Safe to fly.
        </div>
      )}

      {state === "error" && (
        <div
          className="mt-3 inline-flex items-center gap-2 rounded-[10px] px-3 py-2 text-[11.5px] font-bold"
          style={{
            background: "var(--bento-danger-soft)",
            color: "var(--bento-danger)",
          }}
        >
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.8} /> {err ?? "Download failed"}
        </div>
      )}
    </div>
  );
}
