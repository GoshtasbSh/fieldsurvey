"""POST /api/team/claim — newly-signed-up user redeems today's invite code.

Body: {"code": "ABC123"}
Auth: Bearer Supabase JWT required.
Returns: {"ok": bool, "role": str?, "error": str?, "already": bool?}
"""
from http.server import BaseHTTPRequestHandler
import json, sys, pathlib
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))
from _lib import json_response, require_auth, authed_supabase, check_upload_size


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if require_auth(self) is None:
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
        code = (body.get("code") or "").strip()
        if not code:
            json_response(self, 400, {"ok": False, "error": "Missing 'code'."})
            return
        try:
            r = sb.rpc("claim_membership", {"p_code": code}).execute()
            payload = r.data
            if isinstance(payload, list) and payload:
                payload = payload[0]
        except Exception as e:
            json_response(self, 500, {"ok": False, "error": f"RPC failed: {e!s}"})
            return
        status = 200 if isinstance(payload, dict) and payload.get("ok") else 400
        json_response(self, status, payload or {"ok": False, "error": "Empty RPC response."})
