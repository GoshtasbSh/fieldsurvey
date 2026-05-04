"""GET /api/iaq-points — IAQ survey GeoJSON.

Default (anonymous): per-respondent SURVEY_ANSWER_FIELDS are stripped from
each feature so individual residents' answers never leak via the public
endpoint. Cached aggressively at the CDN.

?full=1  (auth-gated, team-member required): returns the full payload with
SURVEY_ANSWER_FIELDS preserved so the dashboard's Survey Answers popup tab
can render. Response is `Cache-Control: private` — never let a shared CDN
serve a signed-in user's PII to an anonymous one.
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import (
    load_cached, json_response, empty_geojson, strip_survey_answers,
    require_team_member,
)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        qs = parse_qs(urlparse(self.path).query)
        want_full = (qs.get("full", ["0"])[0] or "").lower() in ("1", "true", "yes")

        payload = load_cached("iaq_survey") or {}
        data = payload.get("geojson") if isinstance(payload, dict) else None

        if want_full:
            # Auth-gate: any team member (admin or member) may see full answers.
            if require_team_member(self) is None:
                return  # 401/403 already written
            json_response(self, 200, data or empty_geojson(),
                          cache="private, max-age=30")
            return

        # Anonymous public path: strip SURVEY_ANSWER_FIELDS.
        data = strip_survey_answers(data) if data else empty_geojson()
        json_response(self, 200, data, cache="public, max-age=30")
