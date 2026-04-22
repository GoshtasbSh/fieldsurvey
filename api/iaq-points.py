"""GET /api/iaq-points — IAQ survey GeoJSON."""
from http.server import BaseHTTPRequestHandler

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import load_cached, json_response, empty_geojson


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data = load_cached("iaq_points") or empty_geojson()
        json_response(self, 200, data, cache="public, max-age=30")
