"""POST /api/guest/heartbeat — keep a guest session alive while idle.

Body: {"session_id": "uuid"}
Auth: session_id (validated against field_guest_sessions).
Returns: {"ok": true, "expires_at": "..."} | {"ok": false, "error": "..."}

The field-app calls this every few minutes while the user is on-screen but
not actively saving points, so the sliding-window TTL doesn't kick the
guest out mid-day.
"""
from http.server import BaseHTTPRequestHandler
import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))
from _lib import json_response, supabase_admin
from guest._helpers import parse_body, load_session, session_status, touch_session


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = parse_body(self, max_bytes=2048)
        if body is None:
            return
        sid = (body.get("session_id") or "").strip()
        sb = supabase_admin()
        if not sb:
            json_response(self, 503, {"ok": False, "error": "Service unavailable."})
            return
        sess = load_session(sb, sid)
        st = session_status(sess)
        if st != "ok":
            json_response(self, 401, {"ok": False, "error": st, "session_status": st})
            return
        touch_session(sb, sess["id"])
        # Re-load to return the new expires_at to the client.
        fresh = load_session(sb, sid) or sess
        json_response(self, 200, {
            "ok":         True,
            "name":       fresh["name"],
            "expires_at": fresh["expires_at"],
        })
