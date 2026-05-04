"""POST /api/guest/my-points — return the points THIS guest has added today.

Body: {"session_id": "uuid"}
Auth: session_id (validated against field_guest_sessions).
Returns: {"ok": true, "points": [{id, lat, lon, status, notes, collected_at}], "expires_at": "..."}
"""
from http.server import BaseHTTPRequestHandler
import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))
from _lib import json_response, supabase_admin
from guest._helpers import parse_body, load_session, session_status, touch_session


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = parse_body(self, max_bytes=4096)
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
        try:
            r = (sb.table("field_survey_points")
                   .select("id,lat,lon,status,notes,collected_at")
                   .eq("guest_session_id", sess["id"])
                   .order("collected_at", desc=True)
                   .limit(500)
                   .execute())
            pts = r.data or []
        except Exception as e:
            print(f"[guest/my-points] read FAIL {type(e).__name__}: {e}")
            json_response(self, 500, {"ok": False, "error": "Could not load points."})
            return
        touch_session(sb, sess["id"])
        json_response(self, 200, {
            "ok":         True,
            "points":     pts,
            "expires_at": sess["expires_at"],
        })
