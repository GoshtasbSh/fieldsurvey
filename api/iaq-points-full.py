"""GET /api/iaq-points-full — auth-gated full IAQ GeoJSON (team members only).

Mirrors Flask ``app.py`` ``api_iaq_pts_full``. Use from the dashboard so Survey
Answers popups work against local uvicorn as well as Vercel (which also
supports ``/api/iaq-points?full=1`` on ``iaq-points.py``).
"""
from http.server import BaseHTTPRequestHandler

import pathlib
import sys

sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import empty_geojson, json_response, load_cached, require_team_member


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if require_team_member(self) is None:
            return
        payload = load_cached("iaq_survey") or {}
        data = payload.get("geojson") if isinstance(payload, dict) else None
        json_response(self, 200, data or empty_geojson(), cache="no-store")
