"""GET /api/survey-points — cached community-contact GeoJSON from Supabase."""
from http.server import BaseHTTPRequestHandler

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import load_cached, json_response, empty_geojson


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data = load_cached("survey_points") or empty_geojson()
        json_response(self, 200, data, cache="public, max-age=30")
