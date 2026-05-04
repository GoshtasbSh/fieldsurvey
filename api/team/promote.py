"""POST /api/team/promote — admin-only. Promotes a team member to admin.

Body: {"user_id": "uuid"}
Auth: admin role required.
"""
from http.server import BaseHTTPRequestHandler
import json, sys, pathlib
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))
from _lib import json_response, require_admin, authed_supabase, check_upload_size


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if require_admin(self) is None:
            return
        sb = authed_supabase(self)
        if not sb:
            json_response(self, 503, {"ok": False, "error": "Auth service unavailable."})
            return
        length = check_upload_size(self, max_bytes=4096)
        if length is None:
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception:
            json_response(self, 400, {"ok": False, "error": "Invalid JSON body."})
            return
        target = (body.get("user_id") or "").strip()
        if not target:
            json_response(self, 400, {"ok": False, "error": "Missing 'user_id'."})
            return
        try:
            r = sb.rpc("promote_member", {"p_target": target}).execute()
            payload = r.data
            if isinstance(payload, list) and payload:
                payload = payload[0]
        except Exception as e:
            json_response(self, 500, {"ok": False, "error": f"RPC failed: {e!s}"})
            return
        status = 200 if isinstance(payload, dict) and payload.get("ok") else 400
        json_response(self, status, payload or {"ok": False, "error": "Empty RPC response."})
