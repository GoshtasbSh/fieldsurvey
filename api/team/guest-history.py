"""GET /api/team/guest-history?date=YYYY-MM-DD — admin-only roster of
guest sessions for a specific UTC date (defaults to today).

Auth: admin role required.
Returns: {"ok": true, "date": "YYYY-MM-DD", "sessions": [...]}
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone
import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))
from _lib import json_response, require_admin, authed_supabase


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if require_admin(self) is None:
            return
        sb = authed_supabase(self)
        if not sb:
            json_response(self, 503, {"ok": False, "error": "Service unavailable."})
            return
        qs   = parse_qs(urlparse(self.path).query)
        raw  = (qs.get("date", [""])[0] or "").strip()
        if raw:
            try:
                date_iso = datetime.strptime(raw, "%Y-%m-%d").date().isoformat()
            except ValueError:
                json_response(self, 400, {"ok": False, "error": "Invalid date — use YYYY-MM-DD."})
                return
        else:
            date_iso = datetime.now(timezone.utc).date().isoformat()
        try:
            r = sb.rpc("list_guest_sessions", {"p_date": date_iso}).execute()
            rows = r.data or []
        except Exception as e:
            json_response(self, 500, {"ok": False, "error": f"RPC failed: {e!s}"})
            return
        json_response(self, 200, {"ok": True, "date": date_iso, "sessions": rows})
