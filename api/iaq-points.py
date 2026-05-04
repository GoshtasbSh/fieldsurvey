"""GET /api/iaq-points — IAQ survey GeoJSON extracted from cached payload.

Public endpoint: per-respondent SURVEY_ANSWER_FIELDS (residency/safety/
affordability/interventions/experiences/mobility/demographics answers) are
stripped from each feature so individuals' answers never leak through the
anonymous endpoint. Signed-in dashboard users can fetch the full payload
including answers via /api/iaq-points-full (auth-gated)."""
from http.server import BaseHTTPRequestHandler

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import load_cached, json_response, empty_geojson, strip_survey_answers


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # The iaq_survey blob contains {geojson, analysis, street_stats, validation}
        payload = load_cached("iaq_survey") or {}
        data = payload.get("geojson") if isinstance(payload, dict) else None
        data = strip_survey_answers(data) if data else empty_geojson()
        json_response(self, 200, data, cache="public, max-age=30")
