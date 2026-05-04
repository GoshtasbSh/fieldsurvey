"""GET /api/field-points — live field-collected points as GeoJSON.

Reads field_survey_points via the service-role client so unauthenticated
viewers (PIs / public dashboard) and viewers who aren't yet in the
team_members table can still see real-time field activity. RLS on
field_survey_points itself remains team-member-only for direct PostgREST
writes; this endpoint is read-only and exposes the same fields the
field PWA already shares team-wide (location, status, collector name).

Caching is short (10 s) so dashboards see new pins quickly even if the
client doesn't have an active Supabase realtime subscription.
"""
from http.server import BaseHTTPRequestHandler

import sys
import pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import supabase_admin, json_response, empty_geojson

PAGE = 1000
HARD_CAP = 100_000


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        sb = supabase_admin()
        if not sb:
            json_response(self, 200, empty_geojson(), cache="no-store")
            return

        rows = []
        offset = 0
        try:
            while offset < HARD_CAP:
                r = (
                    sb.table("field_survey_points")
                    .select(
                        "id,lat,lon,status,notes,collector_id,"
                        "collector_name,collected_at"
                    )
                    .order("collected_at", desc=True)
                    .range(offset, offset + PAGE - 1)
                    .execute()
                )
                batch = r.data or []
                if not batch:
                    break
                rows.extend(batch)
                if len(batch) < PAGE:
                    break
                offset += PAGE
        except Exception:
            json_response(self, 200, empty_geojson(), cache="no-store")
            return

        features = []
        for p in rows:
            try:
                lon = float(p.get("lon"))
                lat = float(p.get("lat"))
            except (TypeError, ValueError):
                continue
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": p.get("id"),
                    "status": p.get("status") or "Unknown",
                    "notes": p.get("notes") or "",
                    "collector_id": p.get("collector_id"),
                    "collector": p.get("collector_name") or "Unknown",
                    "collected_at": p.get("collected_at"),
                    "is_field": True,
                },
            })

        json_response(
            self, 200,
            {"type": "FeatureCollection", "features": features},
            cache="public, max-age=10",
        )
