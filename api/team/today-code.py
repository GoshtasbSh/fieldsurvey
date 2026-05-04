"""POST /api/team/today-code — admin-only. Returns today's invite code,
generating it on first call of the day.

Auth: admin role required.
Returns: {"ok": bool, "date": "YYYY-MM-DD", "code": "XXXXXX", "error": str?}
"""
from http.server import BaseHTTPRequestHandler
import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))
from _lib import json_response, require_admin, authed_supabase


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if require_admin(self) is None:
            return
        sb = authed_supabase(self)
        if not sb:
            json_response(self, 503, {"ok": False, "error": "Auth service unavailable."})
            return
        try:
            r = sb.rpc("get_or_create_today_code").execute()
            payload = r.data
            if isinstance(payload, list) and payload:
                payload = payload[0]
        except Exception as e:
            json_response(self, 500, {"ok": False, "error": f"RPC failed: {e!s}"})
            return
        status = 200 if isinstance(payload, dict) and payload.get("ok") else 403
        json_response(self, status, payload or {"ok": False, "error": "Empty RPC response."})
