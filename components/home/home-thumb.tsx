"use client";

/**
 * Project card thumbnail for /home.
 *
 * When the server has pre-rendered a static PNG (`thumb_path` set), render
 * an <img> straight from the public `project-thumbs` bucket — no Leaflet,
 * no IntersectionObserver, no client-side tile fetching.
 *
 * When no static thumb exists yet, fall back to the existing lazy-Leaflet
 * path so /home stays usable while the thumb-refresh pipeline catches up.
 * Tile source = Carto Dark Matter (OSM-derived; no API key).
 */

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";

type Props = {
  lat: number;
  lon: number;
  zoom?: number;
  basemap?: "dark" | "satellite";
  /** Static thumb URL (publicly readable Storage object). When present, used directly. */
  thumbUrl?: string | null;
};

export function HomeThumb({ lat, lon, zoom = 13, basemap = "satellite", thumbUrl }: Props) {
  const [staticErrored, setStaticErrored] = useState(false);

  // Static path: render `<img>` straight from the public bucket.
  if (thumbUrl && !staticErrored) {
    return (
      <img
        src={thumbUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
        onError={() => setStaticErrored(true)}
      />
    );
  }

  return <LeafletThumb lat={lat} lon={lon} zoom={zoom} basemap={basemap} />;
}

function LeafletThumb({
  lat,
  lon,
  zoom,
  basemap,
}: {
  lat: number;
  lon: number;
  zoom: number;
  basemap: "dark" | "satellite";
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
      if (basemap === "satellite") {
        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 19 },
        ).addTo(m);
        // Reference labels overlay so city/town names are readable.
        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 19, opacity: 0.95 },
        ).addTo(m);
      } else {
        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
          maxZoom: 19,
          subdomains: "abcd",
        }).addTo(m);
      }
      if (ref.current) ref.current.style.pointerEvents = "none";
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [visible, lat, lon, zoom, basemap]);

  return <div ref={ref} className="h-full w-full bg-[var(--bento-surface-3)]" aria-hidden />;
}
