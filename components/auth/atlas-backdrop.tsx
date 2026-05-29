"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";

const US_POINTS: Array<{ center: [number, number]; zoom: number; label: string }> = [
  { center: [29.135, -83.035], zoom: 8, label: "CEDAR KEY · 29.1°N 83.0°W" },
  { center: [29.651, -82.324], zoom: 8, label: "GAINESVILLE · 29.7°N 82.3°W" },
  { center: [29.726, -84.987], zoom: 7, label: "APALACHICOLA BAY · 29.7°N 85.0°W" },
  { center: [27.901, -81.585], zoom: 8, label: "LAKE WALES · 27.9°N 81.6°W" },
  { center: [28.452, -81.555], zoom: 8, label: "ORANGE CO. · 28.5°N 81.6°W" },
];

export function AtlasBackdrop({ onLegChange }: { onLegChange?: (label: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let idx = 0;

    (async () => {
      const L = (await import("leaflet")).default;
      // Leaflet's default marker icons reference image files that won't resolve in Next bundle.
      // We don't render markers anyway, so this is just defensive.
      // @ts-expect-error — private API; safe to clear.
      delete L.Icon.Default.prototype._getIconUrl;

      if (cancelled || !containerRef.current) return;

      const first = US_POINTS[0];
      const map = L.map(containerRef.current, {
        center: first.center,
        zoom: first.zoom,
        zoomControl: false,
        attributionControl: true,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
        // @ts-expect-error tap option exists in Leaflet runtime but is missing from current d.ts
        tap: false,
        fadeAnimation: true,
        zoomSnap: 0.1,
      });
      mapRef.current = map;

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
          maxZoom: 19,
          subdomains: "abcd",
        }
      ).addTo(map);

      // Make the host non-interactive after Leaflet renders so it never steals pointer events.
      if (containerRef.current) {
        containerRef.current.style.pointerEvents = "none";
      }
      onLegChange?.(first.label);

      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduced) return;

      // Cycle through US points
      intervalRef.current = setInterval(() => {
        if (document.hidden) return; // pause when tab backgrounds
        idx = (idx + 1) % US_POINTS.length;
        const next = US_POINTS[idx];
        map.flyTo(next.center, next.zoom, { duration: 6, easeLinearity: 0.25 });
        onLegChange?.(next.label);
      }, 9000);
    })();

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [onLegChange]);

  return <div ref={containerRef} className="fos-map" aria-hidden="true" />;
}
