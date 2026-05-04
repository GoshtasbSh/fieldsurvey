"""GET /api/team/list — team-member-only. Returns the team roster.

Auth: team membership required.
Returns: {"ok": true, "members": [{id, email, role, joined_at, promoted_at}, ...]}
"""
from http.server import BaseHTTPRequestHandler
import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))
from _lib import json_response, require_team_member, authed_supabase


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if require_team_member(self) is None:
            return
        sb = authed_supabase(self)
        if not sb:
            json_response(self, 503, {"ok": False, "error": "Auth service unavailable."})
            return
        try:
            r = sb.rpc("list_team").execute()
            members = r.data or []
        except Exception as e:
            json_response(self, 500, {"ok": False, "error": f"RPC failed: {e!s}"})
            return
        json_response(self, 200, {"ok": True, "members": members})


    def do_POST(self):
        # Allow POST too so the dashboard can use a single fetch shape if needed.
        return self.do_GET()
