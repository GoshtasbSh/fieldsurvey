"""GET /api/field-points — live field-collected points as GeoJSON.

Two access levels:
  - No auth / guest: notes + collector identifiers stripped.
  - Team member (Bearer JWT): full properties.

Caching is short (10 s) so dashboards see new pins quickly even if the
client doesn't have an active Supabase realtime subscription.
"""
from http.server import BaseHTTPRequestHandler

import sys
import pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import supabase_admin, json_response, empty_geojson, _bearer_jwt

PAGE = 1000
HARD_CAP = 100_000


def _is_team_member(jwt: str | None) -> bool:
    if not jwt:
        return False
    from _lib import supabase_anon
    sb_anon = supabase_anon()
    sb_adm = supabase_admin()
    if not sb_anon or not sb_adm:
        return False
    try:
        resp = sb_anon.auth.get_user(jwt)
        user = getattr(resp, "user", None)
        uid = getattr(user, "id", None) if user else None
        if not uid:
            return False
        r = sb_adm.table("team_members").select("role").eq("id", uid).limit(1).execute()
        return bool(r.data)
    except Exception:
        return False


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
                        "collector_name,guest_session_id,collected_at"
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
        except Exception as _e:
            print(f"[field-points] Supabase fetch error: {_e}")
            json_response(self, 503, {"error": "data unavailable"}, cache="no-store")
            return

        is_member = _is_team_member(_bearer_jwt(self))
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
                    "notes": (p.get("notes") or "") if is_member else "",
                    "collector_id": p.get("collector_id") if is_member else None,
                    "collector": p.get("collector_name") or "Unknown",
                    # Required so the field-web's pointsToGeoJSON can
                    # mark a guest's own pins as is_mine=true. Without
                    # this, the 30 s polling refresh wiped guest_session_id
                    # from every pin and Edit/Delete buttons disappeared.
                    "guest_session_id": p.get("guest_session_id") if is_member else None,
                    "collected_at": p.get("collected_at"),
                    "is_field": True,
                },
            })

        json_response(
            self, 200,
            {"type": "FeatureCollection", "features": features},
            cache="public, max-age=10",
        )
