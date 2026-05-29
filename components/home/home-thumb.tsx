"use client";

/**
 * Lazy-initialised Leaflet thumbnail for a single project card on /home.
 * Uses IntersectionObserver so off-screen cards do not boot a map.
 * Tile source = Carto Dark Matter (OSM-derived; no API key).
 */

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";

type Props = {
  lat: number;
  lon: number;
  zoom?: number;
  basemap?: "dark" | "satellite";
};

export function HomeThumb({ lat, lon, zoom = 13, basemap = "dark" }: Props) {
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
      const tileUrl =
        basemap === "satellite"
          ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
      L.tileLayer(tileUrl, { maxZoom: 19, subdomains: "abcd" }).addTo(m);
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
