"""GET /api/community-contacts — geocoded community contact points.

Two access levels (mirrors the iaq-points / survey-points pattern):
  - No auth / guest: notes, status_detail, second_attempt stripped.
  - Team member (Bearer JWT): full properties.

?filter=today  limit to today's collected entries.
"""
from http.server import BaseHTTPRequestHandler
from datetime import date
from urllib.parse import urlparse, parse_qs

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import load_cached, json_response, empty_geojson, _bearer_jwt


_PII_FIELDS = {
    'notes', 'status_detail', 'second_attempt',
    # Residential address fields are PII for non-team callers.
    'address', 'matched_address', 'street_name',
}


def _strip_pii(geojson: dict) -> dict:
    features = []
    for f in geojson.get('features', []):
        props = {k: v for k, v in (f.get('properties') or {}).items()
                 if k not in _PII_FIELDS}
        features.append({**f, 'properties': props})
    return {**geojson, 'features': features}


def _is_team_member(jwt: str | None) -> bool:
    if not jwt:
        return False
    from _lib import supabase_anon, supabase_admin
    sb_anon = supabase_anon()
    sb_adm  = supabase_admin()
    if not sb_anon or not sb_adm:
        return False
    try:
        resp = sb_anon.auth.get_user(jwt)
        user = getattr(resp, 'user', None)
        uid  = getattr(user, 'id', None) if user else None
        if not uid:
            return False
        r = sb_adm.table('team_members').select('role').eq('id', uid).limit(1).execute()
        return bool(r.data)
    except Exception:
        return False


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data = load_cached('community_contact') or empty_geojson()
        qs   = parse_qs(urlparse(self.path).query)

        if qs.get('filter', [''])[0] == 'today':
            today = date.today().isoformat()
            feats = [f for f in data.get('features', [])
                     if f.get('properties', {}).get('date', '') == today]
            data = {**data, 'features': feats, 'total': len(feats)}
        else:
            data = {**data, 'total': len(data.get('features', []))}

        if not _is_team_member(_bearer_jwt(self)):
            data = _strip_pii(data)

        json_response(self, 200, data, cache='public, max-age=15')
