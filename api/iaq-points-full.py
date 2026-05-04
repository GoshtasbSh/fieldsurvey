"""GET /api/iaq-points-full — IAQ survey GeoJSON WITH per-respondent answers.

Auth-gated: Supabase Bearer token required. Returns the same payload as
/api/iaq-points but preserves the SURVEY_ANSWER_FIELDS on each feature so
the dashboard's "Survey Answers" popup tab can render per-question answers.

Anonymous callers MUST use /api/iaq-points (which strips those fields).
"""
from http.server import BaseHTTPRequestHandler

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import load_cached, json_response, empty_geojson, require_auth


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # 401 + early return if no valid Supabase JWT.
        if require_auth(self) is None:
            return
        payload = load_cached("iaq_survey") or {}
        data = payload.get("geojson") if isinstance(payload, dict) else None
        # Cache must be 'private' here — never let a shared CDN serve a
        # signed-in user's PII to an anonymous one.
        json_response(self, 200, data or empty_geojson(),
                      cache="private, max-age=30")
