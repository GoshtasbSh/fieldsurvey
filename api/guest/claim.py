"""POST /api/guest/claim — ephemeral guest surveyor claims today's code.

Body: {"name": "Jane Smith", "code": "ABC123"}
Auth: NONE (guests don't have Supabase accounts).
Returns: {"ok": true, "session_id": "...", "name": "...", "expires_at": "..."}
        | {"ok": false, "error": "..."}
"""
from http.server import BaseHTTPRequestHandler
import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))
from _lib import json_response, supabase_admin
from guest._helpers import (
    parse_body, today_utc, fetch_today_code, get_client_ip, hash_ip, name_safe,
)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = parse_body(self)
        if body is None:
            return  # 400 already written
        name = name_safe(body.get("name") or "")
        code = (body.get("code") or "").strip().upper()
        if len(name) < 2:
            json_response(self, 400, {"ok": False, "error": "Enter your full name (≥2 characters)."})
            return
        if not code:
            json_response(self, 400, {"ok": False, "error": "Enter today's invite code."})
            return

        sb = supabase_admin()
        if not sb:
            json_response(self, 503, {"ok": False, "error": "Service unavailable."})
            return

        today_code = fetch_today_code(sb)
        if not today_code or today_code.upper() != code:
            json_response(self, 401, {"ok": False, "error": "Invalid or expired invite code. Ask an admin."})
            return

        ua = (self.headers.get("User-Agent") or "")[:200]
        ip_h = hash_ip(get_client_ip(self))

        try:
            r = (sb.table("field_guest_sessions")
                   .insert({
                       "name":        name,
                       "invite_date": today_utc().isoformat(),
                       "device_ua":   ua,
                       "ip_hash":     ip_h,
                   })
                   .execute())
            row = (r.data or [None])[0]
        except Exception as e:
            print(f"[guest/claim] insert FAIL {type(e).__name__}: {e}")
            json_response(self, 500, {"ok": False, "error": "Could not start guest session."})
            return

        if not row or not row.get("id"):
            json_response(self, 500, {"ok": False, "error": "Could not start guest session."})
            return

        json_response(self, 200, {
            "ok":         True,
            "session_id": row["id"],
            "name":       row["name"],
            "expires_at": row["expires_at"],
        })
