"""GET /api/iaq-analysis — IAQ aggregated stats + street stats + validation."""
from http.server import BaseHTTPRequestHandler

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import load_cached, json_response


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        payload = load_cached("iaq_survey")
        if not payload or not isinstance(payload, dict):
            json_response(self, 200, {"loaded": False}, cache="public, max-age=30")
            return
        # Merge the sub-structures the dashboard expects at top level
        out = {"loaded": True}
        for k in ("analysis", "street_stats", "validation"):
            if k in payload:
                out[k] = payload[k]
        # Back-compat: some dashboards expect the analysis keys at top level
        if "analysis" in payload and isinstance(payload["analysis"], dict):
            for k, v in payload["analysis"].items():
                out.setdefault(k, v)
        json_response(self, 200, out, cache="public, max-age=30")
