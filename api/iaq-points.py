"""GET /api/iaq-points — IAQ survey GeoJSON extracted from cached payload."""
from http.server import BaseHTTPRequestHandler

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import load_cached, json_response, empty_geojson


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # The iaq_survey blob contains {geojson, analysis, street_stats, validation}
        payload = load_cached("iaq_survey") or {}
        data = payload.get("geojson") if isinstance(payload, dict) else None
        json_response(self, 200, data or empty_geojson(), cache="public, max-age=30")
