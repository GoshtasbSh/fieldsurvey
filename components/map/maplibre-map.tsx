"use client";

import { useEffect, useMemo, useRef } from "react";
import maplibregl, { type Map, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MATCH_RING } from "@/lib/match/status";
import type { MatchStatusRow } from "@/lib/match/status";

export type StatusColorMap = Record<string, string>;
export type LayerVisibility = {
  points: boolean;
  heatmap: boolean;
  clusters: boolean;
  boundary?: boolean;
};

type Props = {
  center: [number, number];
  zoom: number;
  features: MatchStatusRow[];
  statusColors: StatusColorMap;
  selectedId: string | null;
  onSelect: (pointId: string) => void;
  /** If omitted, defaults to points-only — backwards-compatible with mobile shell. */
  layers?: LayerVisibility;
};

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors", maxzoom: 19 },
  },
  layers: [{ id: "osm-tiles", type: "raster", source: "osm", paint: { "raster-saturation": -0.55, "raster-brightness-min": 0.05, "raster-contrast": 0.1 } }],
};

const DEFAULT_LAYERS: LayerVisibility = { points: true, heatmap: false, clusters: false, boundary: false };

export function MaplibreMap({ center, zoom, features, statusColors, selectedId, onSelect, layers = DEFAULT_LAYERS }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);

  // Two GeoJSON FeatureCollections so heatmap/points can stay un-clustered
  // while clusters use a separate clustered source (MapLibre limitation:
  // a single source cluster flag toggles clustering for that source).
  const fcRaw = useMemo(() => toGeoJSON(features, statusColors), [features, statusColors]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: OSM_STYLE, center, zoom, attributionControl: false });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      // Un-clustered source — feeds the heatmap and the per-point circles
      map.addSource("ms-points", { type: "geojson", data: fcRaw });
      // Clustered source — same data, different config
      map.addSource("ms-points-clustered", { type: "geojson", data: fcRaw, cluster: true, clusterMaxZoom: 16, clusterRadius: 45 });

      // ── Heatmap layer (hidden by default) ──────────────────────────
      map.addLayer({
        id: "ms-heat",
        type: "heatmap",
        source: "ms-points",
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 1, 18, 4],
          // sky → cyan → green → yellow → red density gradient
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(56, 189, 248, 0)",
            0.2, "rgba(76, 200, 220, 0.45)",
            0.4, "rgba(102, 220, 158, 0.7)",
            0.6, "rgba(245, 200, 80, 0.85)",
            0.85, "rgba(245, 140, 40, 0.95)",
            1, "rgba(239, 68, 68, 1)",
          ],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 18, 18, 60],
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.85, 18, 0.6],
        },
      });

      // ── Cluster layers (hidden by default) ─────────────────────────
      map.addLayer({
        id: "ms-cluster-bubble",
        type: "circle",
        source: "ms-points-clustered",
        filter: ["has", "point_count"],
        layout: { visibility: "none" },
        paint: {
          "circle-color": [
            "step", ["get", "point_count"],
            "#34d399",  // < 25 = green
            25, "#38bdf8", // 25–100 = sky
            100, "#a78bfa", // 100+ = violet
          ],
          "circle-radius": [
            "step", ["get", "point_count"],
            18,
            25, 24,
            100, 32,
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0d1117",
          "circle-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "ms-cluster-count",
        type: "symbol",
        source: "ms-points-clustered",
        filter: ["has", "point_count"],
        layout: {
          visibility: "none",
          "text-field": "{point_count_abbreviated}",
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": ["step", ["get", "point_count"], 12, 25, 13, 100, 15],
        },
        paint: { "text-color": "#0d1117" },
      });
      // Singletons inside the clustered source (rendered the same as the
      // un-clustered layer so we don't duplicate styling — but only when
      // clusters mode is the active visualization)
      map.addLayer({
        id: "ms-cluster-singleton",
        type: "circle",
        source: "ms-points-clustered",
        filter: ["!", ["has", "point_count"]],
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 5, 19, 11],
          "circle-color": ["coalesce", ["get", "color"], "#9ca3af"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0d1117",
        },
      });

      // ── Points layers (visible by default) ─────────────────────────
      map.addLayer({
        id: "ms-points-bg", type: "circle", source: "ms-points",
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 10, 19, 22], "circle-color": "rgba(0,0,0,0)" },
      });
      map.addLayer({
        id: "ms-points", type: "circle", source: "ms-points",
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
      map.addLayer({
        id: "ms-points-r1", type: "circle", source: "ms-points",
        filter: ["==", ["get", "match_status"], "R1"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 9, 16, 14, 19, 18],
          "circle-color": "rgba(168,85,247,0.0)",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#a855f7",
        },
      });
      map.addLayer({
        id: "ms-points-selected", type: "circle", source: "ms-points",
        filter: ["==", ["get", "id"], selectedId ?? "__none__"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 14, 16, 18, 19, 24],
          "circle-color": "rgba(56,189,248,0.18)",
          "circle-stroke-width": 1, "circle-stroke-color": "#38bdf8",
        },
      });

      // Interaction handlers
      map.on("click", "ms-points-bg", (e) => {
        const f = e.features?.[0];
        if (f?.properties?.id) onSelect(f.properties.id as string);
      });
      map.on("mouseenter", "ms-points-bg", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "ms-points-bg", () => { map.getCanvas().style.cursor = ""; });

      // Click a cluster → zoom in to expand it
      map.on("click", "ms-cluster-bubble", async (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const clusterId = f.properties?.cluster_id;
        const src = map.getSource("ms-points-clustered") as GeoJSONSource;
        try {
          const zoom = await src.getClusterExpansionZoom(clusterId as number);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const coords = (f.geometry as any).coordinates as [number, number];
          map.easeTo({ center: coords, zoom });
        } catch { /* ignore */ }
      });
      map.on("mouseenter", "ms-cluster-bubble", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "ms-cluster-bubble", () => { map.getCanvas().style.cursor = ""; });

      // Apply initial layer visibility
      applyLayerVisibility(map, layers);
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push new data to both sources whenever features change
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource("ms-points") as GeoJSONSource | undefined)?.setData(fcRaw);
    (map.getSource("ms-points-clustered") as GeoJSONSource | undefined)?.setData(fcRaw);
  }, [fcRaw]);

  // Highlight the selected pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    if (map.getLayer("ms-points-selected")) {
      map.setFilter("ms-points-selected", ["==", ["get", "id"], selectedId ?? "__none__"]);
    }
  }, [selectedId]);

  // React to layer-visibility changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    applyLayerVisibility(map, layers);
  }, [layers]);

  return <div ref={containerRef} className="absolute inset-0" />;
}

function applyLayerVisibility(map: Map, layers: LayerVisibility) {
  const setVis = (id: string, vis: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis ? "visible" : "none");
  };
  // Points layer set
  setVis("ms-points-bg", layers.points);
  setVis("ms-points", layers.points);
  setVis("ms-points-r1", layers.points);
  setVis("ms-points-selected", layers.points);
  // Heatmap
  setVis("ms-heat", layers.heatmap);
  // Clusters (and the singletons that live in the clustered source)
  setVis("ms-cluster-bubble", layers.clusters);
  setVis("ms-cluster-count", layers.clusters);
  setVis("ms-cluster-singleton", layers.clusters);
}

function toGeoJSON(features: MatchStatusRow[], statusColors: StatusColorMap): GeoJSON.FeatureCollection {
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
