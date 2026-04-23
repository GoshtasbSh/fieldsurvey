"""GET /api/parcels — parcel polygons as GeoJSON, built from the `parcels` table.

The response is tightly optimised because Vercel caps function bodies at 4.5MB.
We round coordinates to 5 decimals (~1m accuracy — imperceptible at map zoom
levels) and drop empty properties.
"""
from http.server import BaseHTTPRequestHandler

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import supabase_admin, supabase_anon, json_response, empty_geojson


_COORD_PRECISION = 5


def _round_coords(coords):
    if isinstance(coords, (list, tuple)):
        if coords and isinstance(coords[0], (int, float)):
            return [round(c, _COORD_PRECISION) for c in coords]
        return [_round_coords(c) for c in coords]
    return coords


def _round_geom(geom):
    if not geom or "coordinates" not in geom:
        return geom
    return {**geom, "coordinates": _round_coords(geom["coordinates"])}


def _compact_props(row: dict) -> dict:
    out = {}
    for k in ("parcel_id", "address", "land_use", "just_value",
             "assessed_value", "living_area", "year_built"):
        v = row.get(k)
        if v is None or v == "":
            continue
        out[k] = v
    return out


def _build_from_table() -> dict:
    sb = supabase_admin() or supabase_anon()
    if not sb:
        return empty_geojson()
    all_rows, page_size, offset = [], 1000, 0
    while True:
        try:
            r = (
                sb.table("parcels")
                .select("parcel_id, address, land_use, just_value, "
                        "assessed_value, living_area, year_built, geometry")
                .range(offset, offset + page_size - 1)
                .execute()
            )
        except Exception:
            break
        rows = r.data or []
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    features = []
    for row in all_rows:
        geom = row.get("geometry")
        if not geom:
            continue
        features.append({
            "type": "Feature",
            "geometry": _round_geom(geom),
            "properties": _compact_props(row),
        })
    return {"type": "FeatureCollection", "features": features}


def _trim_cached() -> dict | None:
    """Load the cached blob from keystone_dashboard_data and trim it in place
    so the response fits under Vercel's 4.5MB limit."""
    from _lib import load_cached
    raw = load_cached("parcels")
    if not raw or "features" not in raw:
        return None
    feats = raw.get("features") or []
    out = []
    for f in feats:
        if not f or "geometry" not in f:
            continue
        out.append({
            "type": "Feature",
            "geometry": _round_geom(f.get("geometry")),
            "properties": _compact_props(f.get("properties") or {}),
        })
    return {"type": "FeatureCollection", "features": out}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Prefer the cached blob (fast, one query) — trim precision + drop
        # empty props so it fits in Vercel's 4.5MB body limit.
        # Fall back to live table query if the blob is missing/empty.
        data = _trim_cached()
        if not data or not data.get("features"):
            data = _build_from_table()
        json_response(self, 200, data or empty_geojson(), cache="public, max-age=300")
