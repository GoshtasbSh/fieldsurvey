"""GET /api/parcels — cached parcel polygons GeoJSON."""
from http.server import BaseHTTPRequestHandler

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import load_cached, json_response, empty_geojson


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data = load_cached("parcels") or empty_geojson()
        json_response(self, 200, data, cache="public, max-age=300")
