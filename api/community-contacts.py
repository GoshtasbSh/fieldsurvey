"""GET /api/community-contacts — geocoded community contact points.

Mirrors app.py's GET /api/community-contacts endpoint.
Supports ?filter=today to limit to today's collected entries.
"""
from http.server import BaseHTTPRequestHandler
from datetime import date
from urllib.parse import urlparse, parse_qs

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import load_cached, json_response, empty_geojson


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
        json_response(self, 200, data, cache='public, max-age=15')
