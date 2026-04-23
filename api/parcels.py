"""GET /api/parcels — parcel polygons as GeoJSON, built from the `parcels` table."""
from http.server import BaseHTTPRequestHandler

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import supabase_admin, supabase_anon, load_cached, json_response, empty_geojson


def _build_from_table() -> dict | None:
    sb = supabase_admin() or supabase_anon()
    if not sb:
        return None
    try:
        # Paginate — one page may not cover all parcels
        all_rows, page_size, offset = [], 1000, 0
        while True:
            r = (
                sb.table("parcels")
                .select("parcel_id, address, land_use, just_value, assessed_value, "
                        "living_area, year_built, geometry")
                .range(offset, offset + page_size - 1)
                .execute()
            )
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
                "geometry": geom,
                "properties": {
                    "parcel_id": row.get("parcel_id"),
                    "address": row.get("address"),
                    "land_use": row.get("land_use"),
                    "just_value": row.get("just_value"),
                    "assessed_value": row.get("assessed_value"),
                    "living_area": row.get("living_area"),
                    "year_built": row.get("year_built"),
                },
            })
        return {"type": "FeatureCollection", "features": features}
    except Exception:
        return None


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Prefer cached blob if ingest saved one; fall back to live table query
        data = load_cached("parcels") or _build_from_table() or empty_geojson()
        json_response(self, 200, data, cache="public, max-age=300")
