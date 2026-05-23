"use client";

import { useEffect, useMemo, useRef } from "react";
import maplibregl, { type Map, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MATCH_RING } from "@/lib/match/status";
import type { MatchStatusRow } from "@/lib/match/status";

export type StatusColorMap = Record<string, string>;

type Props = {
  center: [number, number];
  zoom: number;
  features: MatchStatusRow[];
  statusColors: StatusColorMap;
  selectedId: string | null;
  onSelect: (pointId: string) => void;
};

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm-tiles",
      type: "raster",
      source: "osm",
      paint: { "raster-saturation": -0.55, "raster-brightness-min": 0.05, "raster-contrast": 0.1 },
    },
  ],
};

/**
 * MapLibre map renderer with Keystone-faithful match-status ring symbology.
 *
 * Three layers:
 *   1. ms-points-bg   — invisible larger hit target (improves tapping)
 *   2. ms-points      — colored circle with status fill + match-status stroke
 *                       Stroke encoding (DO NOT CHANGE):
 *                         M1  → white stroke 1.5px (#ffffff)
 *                         F1  → bright pure yellow 2.8px (#fde047)
 *                         R1  → purple stroke 2.5px (#a855f7) — rendered as
 *                               a slightly larger circle since we don't have
 *                               the SDF house-scanline icon at this slice
 *                               (deferred to next iteration; spec preserved)
 *   3. ms-points-selected — accent halo for the selected pin
 */
export function MaplibreMap({ center, zoom, features, statusColors, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);

  // Build a GeoJSON FeatureCollection from rows — memoized so unrelated
  // re-renders (e.g. router.refresh from RealtimeWatcher) don't trigger
  // a WebGL re-draw of all points.
  const fc = useMemo(() => featuresToGeoJSON(features, statusColors), [features, statusColors]);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center,
      zoom,
      attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      map.addSource("ms-points", { type: "geojson", data: fc });

      // Background larger circle for easier tap (transparent)
      map.addLayer({
        id: "ms-points-bg",
        type: "circle",
        source: "ms-points",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 10, 19, 22],
          "circle-color": "rgba(0,0,0,0)",
        },
      });

      // The main pin layer — circle-color from feature property `color`,
      // stroke driven by match_status (Keystone-exact encoding).
      map.addLayer({
        id: "ms-points",
        type: "circle",
        source: "ms-points",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 6, 16, 9, 19, 13],
          "circle-color": ["coalesce", ["get", "color"], "#9ca3af"],
          "circle-opacity": 0.95,
          "circle-stroke-width": [
            "case",
            ["==", ["get", "match_status"], "F1"], MATCH_RING.F1.width,
            ["==", ["get", "match_status"], "M1"], MATCH_RING.M1.width,
            ["==", ["get", "match_status"], "R1"], MATCH_RING.R1.width,
            2,
          ],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "match_status"], "F1"], MATCH_RING.F1.color,
            ["==", ["get", "match_status"], "M1"], MATCH_RING.M1.color,
            ["==", ["get", "match_status"], "R1"], MATCH_RING.R1.color,
            "rgba(255,255,255,0.5)",
          ],
        },
      });

      // R1 marker variant — slightly squared shape via translate + extra ring
      // (proper SDF house-scanline icon added in the next iteration)
      map.addLayer({
        id: "ms-points-r1",
        type: "circle",
        source: "ms-points",
        filter: ["==", ["get", "match_status"], "R1"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 9, 16, 14, 19, 18],
          "circle-color": "rgba(168,85,247,0.0)",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#a855f7",
        },
      });

      // Selected halo
      map.addLayer({
        id: "ms-points-selected",
        type: "circle",
        source: "ms-points",
        filter: ["==", ["get", "id"], selectedId ?? "__none__"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 14, 16, 18, 19, 24],
          "circle-color": "rgba(56,189,248,0.18)",
          "circle-stroke-width": 1,
          "circle-stroke-color": "#38bdf8",
        },
      });

      map.on("click", "ms-points-bg", (e) => {
        const f = e.features?.[0];
        if (f?.properties?.id) onSelect(f.properties.id as string);
      });
      map.on("mouseenter", "ms-points-bg", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "ms-points-bg", () => { map.getCanvas().style.cursor = ""; });
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update data when features change
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    const src = map.getSource("ms-points") as GeoJSONSource | undefined;
    src?.setData(fc);
  }, [fc]);

  // Update selected halo filter
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    if (map.getLayer("ms-points-selected")) {
      map.setFilter("ms-points-selected", ["==", ["get", "id"], selectedId ?? "__none__"]);
    }
  }, [selectedId]);

  return <div ref={containerRef} className="absolute inset-0" />;
}

function featuresToGeoJSON(features: MatchStatusRow[], statusColors: StatusColorMap): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features
      .filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon))
      .map((f) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [f.lon, f.lat] },
        properties: {
          id: f.point_id ?? f.response_id,
          match_status: f.match_status,
          color: f.status_id ? statusColors[f.status_id] : "#a855f7",
        },
      })),
  };
}
