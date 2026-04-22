"""GET /api/analysis — precomputed status summary + street stats."""
from http.server import BaseHTTPRequestHandler

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import load_cached, json_response


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data = load_cached("analysis") or {}
        json_response(self, 200, data, cache="public, max-age=30")
