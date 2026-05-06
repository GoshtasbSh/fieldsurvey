"""GET /api/survey-points — community-contact GeoJSON.

Two access levels (mirrors the iaq-points pattern):
  - No auth / guest: features returned with notes, status_detail, and
    second_attempt stripped. Coordinates, address, status, and match
    metadata are still included so the map and analysis work normally.
  - Team member (Bearer JWT): full properties including canvassing notes
    and status details.

?bust=<n>  cache-buster (ignored, for client-side forcing only)
"""
from http.server import BaseHTTPRequestHandler

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import load_cached, json_response, empty_geojson, _bearer_jwt, require_team_member


# Fields that contain canvassing PII — omitted from the public response.
_PII_FIELDS = {'notes', 'status_detail', 'second_attempt'}


def _strip_pii(geojson: dict) -> dict:
    """Return a copy of the GeoJSON with PII fields removed from properties."""
    features = []
    for f in geojson.get('features', []):
        props = {k: v for k, v in (f.get('properties') or {}).items()
                 if k not in _PII_FIELDS}
        features.append({**f, 'properties': props})
    return {**geojson, 'features': features}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data = load_cached('community_contact') or empty_geojson()

        # Determine if caller is an authenticated team member. We reuse
        # _bearer_jwt — if the token is present and valid it means the
        # dashboard is calling with the user's Supabase session token.
        jwt = _bearer_jwt(self)
        is_member = False
        if jwt:
            from _lib import supabase_anon, supabase_admin
            sb_anon = supabase_anon()
            sb_adm  = supabase_admin()
            if sb_anon and sb_adm:
                try:
                    resp = sb_anon.auth.get_user(jwt)
                    user = getattr(resp, 'user', None)
                    uid = getattr(user, 'id', None) if user else None
                    if uid:
                        r = sb_adm.table('team_members').select('role').eq('id', uid).limit(1).execute()
                        is_member = bool(r.data)
                except Exception:
                    pass

        if not is_member:
            data = _strip_pii(data)

        json_response(self, 200, data, cache='no-store')
