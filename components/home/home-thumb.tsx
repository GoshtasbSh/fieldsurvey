"use client";

/**
 * Project card thumbnail for /home.
 *
 * Composition (bottom-up):
 *   1. Satellite imagery — either a server-pre-rendered PNG from the
 *      `project-thumbs` bucket (preferred) or a lazy Leaflet fallback
 *      when no static thumb exists yet.
 *   2. Tonal lift via CSS filter so the image feels designed.
 *   3. Bottom-anchored gradient for legibility.
 *   4. Display-typography place name (city + state), bottom-left.
 *   5. Tabular-mono coordinate readout, bottom-right.
 *   6. Subtle centred pin marker with a glow ring.
 *
 * Why layer the typography in CSS rather than baking it into the PNG:
 *   - Crisp text at any DPI, on any device.
 *   - No font-bundling pain on Vercel Functions.
 *   - Iterate the design without invalidating the storage bucket.
 */

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";

type Props = {
  lat: number;
  lon: number;
  zoom?: number;
  /** Static thumb URL (publicly readable Storage object). When present, used directly. */
  thumbUrl?: string | null;
  /** Reverse-geocoded "City, ST" — shown as the headline if present, otherwise we fall back to coordinates. */
  locationLabel?: string | null;
  /** Status drives the pin accent. Active = brand teal; setup = warm amber; archived = ink-3. */
  status?: "active" | "setup_incomplete" | "archived";
};

export function HomeThumb({
  lat,
  lon,
  zoom = 11,
  thumbUrl,
  locationLabel,
  status = "active",
}: Props) {
  const [staticErrored, setStaticErrored] = useState(false);
  const useStatic = !!thumbUrl && !staticErrored;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--bento-surface-3)]">
      {/* Base layer: satellite imagery */}
      {useStatic ? (
        <img
          src={thumbUrl!}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
          style={{ filter: "saturate(1.05) contrast(1.04)" }}
          onError={() => setStaticErrored(true)}
        />
      ) : (
        <div className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-[1.04]">
          <LeafletThumb lat={lat} lon={lon} zoom={zoom} />
        </div>
      )}

      {/* Edge sheen — very subtle inner highlight on top, depth on the bottom */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 18%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.55) 92%, rgba(0,0,0,0.72) 100%)",
        }}
      />

      {/* Centre pin */}
      <CenterPin status={status} />

      {/* Bottom typographic stack */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-4 pb-3">
        <div className="min-w-0 flex-1">
          {locationLabel ? (
            <PlaceTitle label={locationLabel} />
          ) : (
            <CoordTitle lat={lat} lon={lon} />
          )}
        </div>
        <CoordChip lat={lat} lon={lon} />
      </div>
    </div>
  );
}

function PlaceTitle({ label }: { label: string }) {
  // "City, ST" — split so we can style the region as a subdued tag chip.
  const [city, region] = label.includes(",")
    ? [label.slice(0, label.lastIndexOf(",")), label.slice(label.lastIndexOf(",") + 1).trim()]
    : [label, null];
  return (
    <div className="flex flex-col">
      <span
        className="font-display text-[20px] font-extrabold leading-[1.05] tracking-[-0.01em] text-white"
        style={{ textShadow: "0 1px 8px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.65)" }}
      >
        {city}
      </span>
      {region ? (
        <span
          className="mt-[2px] text-[10px] font-semibold uppercase tracking-[0.22em] text-white/75"
          style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}
        >
          {region}
        </span>
      ) : null}
    </div>
  );
}

function CoordTitle({ lat, lon }: { lat: number; lon: number }) {
  return (
    <span
      className="font-display text-[18px] font-extrabold leading-tight tracking-[-0.01em] text-white"
      style={{ textShadow: "0 1px 8px rgba(0,0,0,0.55)" }}
    >
      {fmtCoord(lat, "lat")}, {fmtCoord(lon, "lon")}
    </span>
  );
}

function CoordChip({ lat, lon }: { lat: number; lon: number }) {
  return (
    <div
      className="shrink-0 rounded-[6px] px-[7px] py-[3px] backdrop-blur-md"
      style={{
        background: "rgba(8, 12, 20, 0.45)",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      <span className="block font-mono text-[9.5px] leading-[1.15] tabular-nums text-white/85">
        {lat.toFixed(3)}°{lat >= 0 ? "N" : "S"}
      </span>
      <span className="block font-mono text-[9.5px] leading-[1.15] tabular-nums text-white/85">
        {Math.abs(lon).toFixed(3)}°{lon >= 0 ? "E" : "W"}
      </span>
    </div>
  );
}

function CenterPin({ status }: { status: "active" | "setup_incomplete" | "archived" }) {
  const ringColor =
    status === "active"
      ? "rgba(56, 189, 248, 0.85)" // brand teal-cyan
      : status === "setup_incomplete"
        ? "rgba(251, 191, 36, 0.85)" // amber
        : "rgba(148, 163, 184, 0.65)"; // slate
  const dotColor =
    status === "active"
      ? "#38bdf8"
      : status === "setup_incomplete"
        ? "#fbbf24"
        : "#94a3b8";
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      {/* Outer halo */}
      <div
        className="absolute left-1/2 top-1/2 h-[34px] w-[34px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: `radial-gradient(circle, ${ringColor} 0%, rgba(0,0,0,0) 70%)`,
          opacity: 0.6,
        }}
      />
      {/* Pin */}
      <div
        className="relative h-3.5 w-3.5 rounded-full"
        style={{
          background: "white",
          boxShadow: `0 0 0 1.5px ${ringColor}, 0 2px 6px rgba(0,0,0,0.45)`,
        }}
      >
        <div
          className="absolute inset-[3px] rounded-full"
          style={{ background: dotColor }}
        />
      </div>
      {status === "active" ? (
        <span
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full animate-ping"
          style={{ background: ringColor, opacity: 0.35 }}
        />
      ) : null}
    </div>
  );
}

function fmtCoord(v: number, axis: "lat" | "lon"): string {
  const hemi = axis === "lat" ? (v >= 0 ? "N" : "S") : v >= 0 ? "E" : "W";
  return `${Math.abs(v).toFixed(2)}°${hemi}`;
}

function LeafletThumb({
  lat,
  lon,
  zoom,
}: {
  lat: number;
  lon: number;
  zoom: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !ref.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current) return;
      const m = L.map(ref.current, {
        center: [lat, lon],
        zoom,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
        // @ts-expect-error tap exists at runtime
        tap: false,
      });
      mapRef.current = m;
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19 },
      ).addTo(m);
      if (ref.current) {
        ref.current.style.pointerEvents = "none";
        ref.current.style.filter = "saturate(1.05) contrast(1.04)";
      }
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [visible, lat, lon, zoom]);

  return <div ref={ref} className="h-full w-full" aria-hidden />;
}
