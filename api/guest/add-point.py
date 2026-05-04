"""POST /api/guest/add-point — guest surveyor adds a single field point.

Body: {
  "session_id": "uuid",
  "lat": 29.793, "lon": -82.123,
  "status": "Completed", "notes": "..."
}
Auth: session_id (validated against field_guest_sessions).
Returns: {"ok": true, "id": "...", "expires_at": "..."} | {"ok": false, "error": "..."}
"""
from http.server import BaseHTTPRequestHandler
import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))
from _lib import json_response, supabase_admin
from guest._helpers import (
    parse_body, load_session, session_status, touch_session,
)

ALLOWED_STATUS = {
    'Completed', 'No Answer', 'Inaccessible', 'Not Interested',
    'Left Info', 'Vacant', 'Follow Up', 'Other', 'Unknown',
}


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = parse_body(self)
        if body is None:
            return
        sid    = (body.get("session_id") or "").strip()
        try:
            lat = float(body.get("lat"))
            lon = float(body.get("lon"))
        except (TypeError, ValueError):
            json_response(self, 400, {"ok": False, "error": "lat/lon must be numbers."})
            return
        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            json_response(self, 400, {"ok": False, "error": "lat/lon out of range."})
            return
        status = (body.get("status") or "Unknown").strip()
        if status not in ALLOWED_STATUS:
            json_response(self, 400, {"ok": False, "error": "Invalid status."})
            return
        notes = (body.get("notes") or "").strip()
        if len(notes) > 1000:
            notes = notes[:1000]

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
                   .insert({
                       "lat":              lat,
                       "lon":              lon,
                       "status":           status,
                       "notes":            notes or None,
                       "collector_id":     None,           # guests have no auth.users
                       "collector_name":   sess["name"],
                       "guest_session_id": sess["id"],
                       "is_offline":       bool(body.get("is_offline")),
                   })
                   .execute())
            row = (r.data or [None])[0]
        except Exception as e:
            print(f"[guest/add-point] insert FAIL {type(e).__name__}: {e}")
            json_response(self, 500, {"ok": False, "error": "Could not save point."})
            return

        # Sliding-window: keep the session alive while they're working.
        touch_session(sb, sess["id"])

        if not row:
            json_response(self, 500, {"ok": False, "error": "Could not save point."})
            return

        json_response(self, 200, {
            "ok": True,
            "id":  row.get("id"),
            "expires_at_at_save": sess["expires_at"],
        })
