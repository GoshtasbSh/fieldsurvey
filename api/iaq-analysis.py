"""GET /api/iaq-analysis — IAQ aggregated street stats + risk summaries."""
from http.server import BaseHTTPRequestHandler

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import load_cached, json_response


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data = load_cached("iaq_analysis") or {"loaded": False}
        json_response(self, 200, data, cache="public, max-age=30")
