"""GET /api/survey-points — cached community-contact GeoJSON from Supabase."""
from http.server import BaseHTTPRequestHandler

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import load_cached, json_response, empty_geojson


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # no-store: this blob flips on every CSV upload / daily-refresh.
        # Stale CDN responses produced "uploaded N but panel shows M"
        # reports right after upload. Origin reads are cheap (small
        # JSON, single Supabase select), so freshness > caching here.
        data = load_cached("community_contact") or empty_geojson()
        json_response(self, 200, data, cache="no-store")
