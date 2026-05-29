"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import maplibregl, { type Map, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
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

export type MapHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  flyToCurrentLocation: () => void;
};

export type BasemapKey = "satellite" | "streets" | "light";

export const BASEMAPS: Record<BasemapKey, { label: string; subtitle: string }> = {
  satellite: { label: "Satellite", subtitle: "Esri World Imagery" },
  streets: { label: "Streets", subtitle: "OpenStreetMap" },
  light: { label: "Light", subtitle: "CARTO Voyager" },
};

export type SymbologyOverride = { size?: number; fill_opacity?: number; outline_px?: number };
export type SymbologyMap = Record<string, SymbologyOverride>;

type Props = {
  center: [number, number];
  zoom: number;
  features: MatchStatusRow[];
  statusColors: StatusColorMap;
  selectedId: string | null;
  onSelect: (pointId: string) => void;
  /** If omitted, defaults to points-only — backwards-compatible with mobile shell. */
  layers?: LayerVisibility;
  /** Active basemap key. Defaults to "satellite" (matches Keystone). */
  basemap?: BasemapKey;
  /** When true, cursor becomes crosshair and the next non-point map click fires onPlace. */
  placingMode?: boolean;
  /** Fired when the user clicks the map while placingMode is true (and not on an existing point). */
  onPlace?: (lngLat: { lat: number; lon: number }) => void;
  /** Per-status paint overrides (Q4 locked). */
  symbology?: SymbologyMap;
};

const SYMB_DEFAULTS = { size: 8, fill_opacity: 0.85, outline_px: 1.5 };

const DEFAULT_LAYERS: LayerVisibility = { points: true, heatmap: false, clusters: false, boundary: false };

const BASEMAP_LAYER_IDS: Record<BasemapKey, string> = {
  satellite: "bm-satellite",
  streets: "bm-streets",
  light: "bm-light",
};

// Custom style with three raster basemap sources, toggleable via visibility.
// Mirrors Keystone's basemap stack: satellite default, streets fallback, light alt.
function buildBaseStyle(active: BasemapKey): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      "bm-satellite": {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      },
      "bm-streets": {
        type: "raster",
        tiles: [
          "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      },
      "bm-light": {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
          "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
          "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/">CARTO</a>',
      },
    },
    layers: (Object.keys(BASEMAP_LAYER_IDS) as BasemapKey[]).map((k) => ({
      id: BASEMAP_LAYER_IDS[k],
      type: "raster" as const,
      source: BASEMAP_LAYER_IDS[k],
      layout: { visibility: k === active ? "visible" : "none" },
    })),
  };
}

export const MaplibreMap = forwardRef<MapHandle, Props>(function MaplibreMap(
  {
    center,
    zoom,
    features,
    statusColors,
    selectedId,
    onSelect,
    layers = DEFAULT_LAYERS,
    basemap = "satellite",
    placingMode = false,
    onPlace,
    symbology,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const placingRef = useRef(placingMode);
  const onPlaceRef = useRef(onPlace);

  // Keep refs in sync so the map-click handler reads the latest values without re-binding.
  placingRef.current = placingMode;
  onPlaceRef.current = onPlace;

  // Two GeoJSON FeatureCollections so heatmap/points can stay un-clustered
  // while clusters use a separate clustered source.
  const fcRaw = useMemo(() => toGeoJSON(features, statusColors), [features, statusColors]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => mapRef.current?.zoomIn(),
    zoomOut: () => mapRef.current?.zoomOut(),
    flyToCurrentLocation: () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          mapRef.current?.flyTo({
            center: [pos.coords.longitude, pos.coords.latitude],
            zoom: 16,
            duration: 1200,
          });
        },
        undefined,
        { enableHighAccuracy: true, timeout: 8000 },
      );
    },
  }));

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildBaseStyle(basemap),
      center,
      zoom,
      attributionControl: false,
    });
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
            "#34d399",
            25, "#38bdf8",
            100, "#a78bfa",
          ],
          "circle-radius": ["step", ["get", "point_count"], 18, 25, 24, 100, 32],
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
          "text-font": ["Noto Sans Regular"],
          "text-size": ["step", ["get", "point_count"], 12, 25, 13, 100, 15],
        },
        paint: { "text-color": "#0d1117" },
      });
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
      map.on("mouseenter", "ms-points-bg", () => {
        if (!placingRef.current) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "ms-points-bg", () => {
        if (!placingRef.current) map.getCanvas().style.cursor = "";
      });

      map.on("click", "ms-cluster-bubble", async (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const clusterId = f.properties?.cluster_id;
        const src = map.getSource("ms-points-clustered") as GeoJSONSource;
        try {
          const z = await src.getClusterExpansionZoom(clusterId as number);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const coords = (f.geometry as any).coordinates as [number, number];
          map.easeTo({ center: coords, zoom: z });
        } catch { /* ignore */ }
      });
      map.on("mouseenter", "ms-cluster-bubble", () => {
        if (!placingRef.current) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "ms-cluster-bubble", () => {
        if (!placingRef.current) map.getCanvas().style.cursor = "";
      });

      // Generic map click — only fires when in placing mode AND not on an existing pin.
      map.on("click", (e) => {
        if (!placingRef.current) return;
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ["ms-points-bg", "ms-cluster-bubble"].filter((id) => map.getLayer(id)),
        });
        if (hits.length > 0) return;
        onPlaceRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
      });

      applyLayerVisibility(map, layers);

      // ── Fit-to-data on first load ──────────────────────────────────
      // KeyStone §6 lesson: never trust the project's hard-coded center —
      // derive viewport from the actual feature bbox so the map opens on
      // the data, not on an empty ocean. Falls back to the initial
      // (center, zoom) only when the project has 0 or 1 features.
      const initialFc = fcRaw;
      const initialFeats = initialFc.features ?? [];
      if (initialFeats.length >= 2) {
        let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
        for (const f of initialFeats) {
          const c = (f.geometry as { coordinates?: [number, number] })?.coordinates;
          if (!c || c.length < 2) continue;
          const [lon, lat] = c;
          if (typeof lon !== "number" || typeof lat !== "number") continue;
          if (lon < minLon) minLon = lon;
          if (lat < minLat) minLat = lat;
          if (lon > maxLon) maxLon = lon;
          if (lat > maxLat) maxLat = lat;
        }
        const span = Math.max(maxLon - minLon, maxLat - minLat);
        // Only fit when the bbox is non-degenerate (>~50 m at the equator).
        if (Number.isFinite(minLon) && span > 0.0005) {
          try {
            map.fitBounds(
              [[minLon, minLat], [maxLon, maxLat]],
              { padding: 60, animate: false, maxZoom: 17 },
            );
          } catch { /* ignore — preserves the initial center/zoom */ }
        }
      }
    });

    // Resize map whenever the outer wrapper changes dimensions (panel collapse/expand)
    const wrapper = containerRef.current?.parentElement;
    let ro: ResizeObserver | null = null;
    if (wrapper) {
      ro = new ResizeObserver(() => {
        if (mapRef.current) mapRef.current.resize();
      });
      ro.observe(wrapper);
    }

    mapRef.current = map;
    return () => {
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toggle basemap visibility without reloading the style — preserves zoom/center and overlay layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (Object.keys(BASEMAP_LAYER_IDS) as BasemapKey[]).forEach((k) => {
      const id = BASEMAP_LAYER_IDS[k];
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", k === basemap ? "visible" : "none");
      }
    });
  }, [basemap]);

  // Crosshair cursor while in placing mode.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = placingMode ? "crosshair" : "";
  }, [placingMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource("ms-points") as GeoJSONSource | undefined)?.setData(fcRaw);
    (map.getSource("ms-points-clustered") as GeoJSONSource | undefined)?.setData(fcRaw);
  }, [fcRaw]);

  // ── Symbology overrides → dynamic paint (Q4 locked). ─────────────────────
  // Each per-status override yields a `match` expression on `status_id`,
  // falling through to the existing default paint for un-overridden statuses.
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    if (!map.getLayer("ms-points")) return;

    const overrides = symbology ?? {};
    const entries = Object.entries(overrides);

    // ── circle-radius ─────────────────────────────────────────────
    // Default is zoom-interpolated 6→9→13 (defaults are tuned to ~size 8
    // at zoom 16). For each overridden status we generate a per-zoom
    // interpolate keyed to the user's chosen size at the mid zoom.
    const defaultRadius: maplibregl.ExpressionSpecification = [
      "interpolate", ["linear"], ["zoom"],
      12, 6,
      16, 9,
      19, 13,
    ];
    if (entries.length === 0) {
      map.setPaintProperty("ms-points", "circle-radius", defaultRadius);
      map.setPaintProperty("ms-points", "circle-opacity", 0.95);
    } else {
      const sizeMatch: unknown[] = ["match", ["coalesce", ["get", "status_id"], ""]];
      for (const [sid, ov] of entries) {
        if (ov?.size === undefined) continue;
        const s = ov.size;
        sizeMatch.push(sid, [
          "interpolate", ["linear"], ["zoom"],
          12, Math.max(2, s * 0.65),
          16, s,
          19, s * 1.55,
        ]);
      }
      // If at least one status has a size override, we need the rest to fall
      // back to defaults.
      sizeMatch.push(defaultRadius);
      const anySizeOverride = entries.some(([, o]) => o?.size !== undefined);
      map.setPaintProperty(
        "ms-points",
        "circle-radius",
        anySizeOverride
          ? (sizeMatch as unknown as maplibregl.ExpressionSpecification)
          : defaultRadius,
      );

      // ── circle-opacity ────────────────────────────────────────────
      const anyOpacityOverride = entries.some(
        ([, o]) => o?.fill_opacity !== undefined,
      );
      if (anyOpacityOverride) {
        const opacityMatch: unknown[] = ["match", ["coalesce", ["get", "status_id"], ""]];
        for (const [sid, ov] of entries) {
          if (ov?.fill_opacity === undefined) continue;
          opacityMatch.push(sid, ov.fill_opacity);
        }
        opacityMatch.push(SYMB_DEFAULTS.fill_opacity);
        map.setPaintProperty(
          "ms-points",
          "circle-opacity",
          opacityMatch as unknown as maplibregl.ExpressionSpecification,
        );
      } else {
        map.setPaintProperty("ms-points", "circle-opacity", 0.95);
      }
    }

    // ── circle-stroke-width — preserve M1/F1/R1 ring case, additionally
    //    apply the user override when set. Per-status override takes priority.
    const matchRingCase: unknown[] = [
      "case",
      ["==", ["get", "match_status"], "F1"], MATCH_RING.F1.width,
      ["==", ["get", "match_status"], "M1"], MATCH_RING.M1.width,
      ["==", ["get", "match_status"], "R1"], MATCH_RING.R1.width,
      2,
    ];
    const anyOutlineOverride = entries.some(([, o]) => o?.outline_px !== undefined);
    if (!anyOutlineOverride) {
      map.setPaintProperty(
        "ms-points",
        "circle-stroke-width",
        matchRingCase as unknown as maplibregl.ExpressionSpecification,
      );
    } else {
      const strokeMatch: unknown[] = ["match", ["coalesce", ["get", "status_id"], ""]];
      for (const [sid, ov] of entries) {
        if (ov?.outline_px === undefined) continue;
        strokeMatch.push(sid, ov.outline_px);
      }
      strokeMatch.push(matchRingCase);
      map.setPaintProperty(
        "ms-points",
        "circle-stroke-width",
        strokeMatch as unknown as maplibregl.ExpressionSpecification,
      );
    }
  }, [symbology]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    if (map.getLayer("ms-points-selected")) {
      map.setFilter("ms-points-selected", ["==", ["get", "id"], selectedId ?? "__none__"]);
    }
  }, [selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    applyLayerVisibility(map, layers);
  }, [layers]);

  // MapLibre GL adds `.maplibregl-map { position: relative }` to the container,
  // which overrides `position: absolute`. Wrapping isolates our layout from that.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
});

function applyLayerVisibility(map: Map, layers: LayerVisibility) {
  const setVis = (id: string, vis: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis ? "visible" : "none");
  };
  setVis("ms-points-bg", layers.points);
  setVis("ms-points", layers.points);
  setVis("ms-points-r1", layers.points);
  setVis("ms-points-selected", layers.points);
  setVis("ms-heat", layers.heatmap);
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
