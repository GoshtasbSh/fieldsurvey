"""POST /api/guest — ephemeral guest-surveyor proxy.

Body: {"action": "claim"|"add-point"|"my-points"|"heartbeat", ...}

Consolidates the previous api/guest/{claim,add-point,my-points,heartbeat}.py
into a single Vercel function so we stay within the Hobby plan's 12-function
ceiling. All the same validation, sliding-window TTL, IP-hashing, and
session-status semantics carry over unchanged.

Auth: NONE for `claim` (the whole point — guests have no Supabase account).
      session_id (validated) for the others.
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
import sys
import pathlib

sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import json_response, supabase_admin


MAX_BODY_BYTES = 64 * 1024
ALLOWED_STATUS = {
    'Completed', 'No Answer', 'Inaccessible', 'Not Interested',
    'Left Info', 'Vacant', 'Follow Up', 'Other', 'Unknown',
}


# ── helpers (inlined from former api/guest/_helpers.py) ────────────────

def _get_client_ip(self) -> str:
    xff = self.headers.get("X-Forwarded-For", "") or ""
    if xff:
        return xff.split(",", 1)[0].strip()
    return self.headers.get("X-Real-IP", "") or ""


def _hash_ip(ip: str) -> str:
    if not ip:
        return ""
    salt = (
        os.environ.get("KEYSTONE_IP_HASH_SALT")
        or os.environ.get("CRON_SECRET")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or "fallback-salt"
    )
    return hashlib.sha256((salt + "|" + ip).encode("utf-8")).hexdigest()[:32]


def _name_safe(name: str) -> str:
    if not name:
        return ""
    s = "".join(ch for ch in name if ord(ch) >= 0x20)
    return " ".join(s.split())[:80]


def _today_utc():
    return datetime.now(timezone.utc).date()


def _fetch_today_code(sb) -> str | None:
    try:
        today = _today_utc().isoformat()
        r = sb.table("invite_codes").select("code").eq("date", today).limit(1).execute()
        rows = r.data or []
        return (rows[0] or {}).get("code") if rows else None
    except Exception:
        return None


def _load_session(sb, session_id: str) -> dict | None:
    if not session_id or len(session_id) != 36:
        return None
    try:
        r = (sb.table("field_guest_sessions")
               .select("id,name,invite_date,created_at,expires_at,last_seen_at,revoked_at")
               .eq("id", session_id).limit(1).execute())
        rows = r.data or []
        return rows[0] if rows else None
    except Exception:
        return None


def _session_status(session: dict | None) -> str:
    if not session:
        return "missing"
    if session.get("revoked_at"):
        return "revoked"
    try:
        exp = session.get("expires_at")
        if isinstance(exp, str):
            exp = exp.replace("Z", "+00:00")
            exp_dt = datetime.fromisoformat(exp)
        else:
            exp_dt = exp
        if exp_dt and exp_dt < datetime.now(timezone.utc):
            return "expired"
    except Exception:
        return "expired"
    return "ok"


def _touch_session(sb, session_id: str, *, extend_hours: int = 4) -> None:
    try:
        now = datetime.now(timezone.utc)
        new_exp = now + timedelta(hours=extend_hours)
        sb.table("field_guest_sessions").update({
            "last_seen_at": now.isoformat(),
            "expires_at":   new_exp.isoformat(),
        }).eq("id", session_id).execute()
    except Exception:
        pass


def _parse_body(self_h, max_bytes: int = MAX_BODY_BYTES) -> dict | None:
    raw = self_h.headers.get("Content-Length") or "0"
    try:
        length = int(raw)
    except (TypeError, ValueError):
        json_response(self_h, 400, {"ok": False, "error": "Invalid Content-Length."})
        return None
    if length < 0 or length > max_bytes:
        json_response(self_h, 413, {"ok": False, "error": f"Body too large (max {max_bytes} bytes)."})
        return None
    if length == 0:
        return {}
    try:
        body = self_h.rfile.read(length).decode("utf-8")
        return json.loads(body) if body else {}
    except Exception:
        json_response(self_h, 400, {"ok": False, "error": "Invalid JSON body."})
        return None


# ── handler ───────────────────────────────────────────────────────────

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = _parse_body(self)
        if body is None:
            return
        action = (body.get("action") or "").strip().lower()
        sb = supabase_admin()
        if not sb:
            json_response(self, 503, {"ok": False, "error": "Service unavailable."})
            return

        if action == "claim":
            return self._claim(body, sb)
        # All other actions require an existing session.
        sid = (body.get("session_id") or "").strip()
        sess = _load_session(sb, sid)
        st = _session_status(sess)
        if st != "ok":
            json_response(self, 401, {"ok": False, "error": st, "session_status": st})
            return

        if action == "add-point":
            return self._add_point(body, sb, sess)
        if action == "my-points":
            return self._my_points(sb, sess)
        if action == "heartbeat":
            return self._heartbeat(sb, sess)
        json_response(self, 400, {"ok": False, "error": f"Unknown action {action!r}."})

    # ── action: claim ───────────────────────────────────────────────
    def _claim(self, body: dict, sb):
        name = _name_safe(body.get("name") or "")
        code = (body.get("code") or "").strip().upper()
        if len(name) < 2:
            json_response(self, 400, {"ok": False, "error": "Enter your full name (≥2 characters)."})
            return
        if not code:
            json_response(self, 400, {"ok": False, "error": "Enter today's invite code."})
            return
        today_code = _fetch_today_code(sb)
        if not today_code or today_code.upper() != code:
            json_response(self, 401, {"ok": False, "error": "Invalid or expired invite code. Ask an admin."})
            return
        ua = (self.headers.get("User-Agent") or "")[:200]
        ip_h = _hash_ip(_get_client_ip(self))
        try:
            r = (sb.table("field_guest_sessions").insert({
                "name":        name,
                "invite_date": _today_utc().isoformat(),
                "device_ua":   ua,
                "ip_hash":     ip_h,
            }).execute())
            row = (r.data or [None])[0]
        except Exception as e:
            print(f"[guest/claim] insert FAIL {type(e).__name__}: {e}")
            json_response(self, 500, {"ok": False, "error": "Could not start guest session."})
            return
        if not row or not row.get("id"):
            json_response(self, 500, {"ok": False, "error": "Could not start guest session."})
            return
        json_response(self, 200, {
            "ok": True,
            "session_id": row["id"],
            "name":       row["name"],
            "expires_at": row["expires_at"],
        })

    # ── action: add-point ─────────────────────────────────────────────
    def _add_point(self, body: dict, sb, sess: dict):
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
        try:
            r = (sb.table("field_survey_points").insert({
                "lat":              lat,
                "lon":              lon,
                "status":           status,
                "notes":            notes or None,
                "collector_id":     None,
                "collector_name":   sess["name"],
                "guest_session_id": sess["id"],
                "is_offline":       bool(body.get("is_offline")),
            }).execute())
            row = (r.data or [None])[0]
        except Exception as e:
            print(f"[guest/add-point] insert FAIL {type(e).__name__}: {e}")
            json_response(self, 500, {"ok": False, "error": "Could not save point."})
            return
        _touch_session(sb, sess["id"])
        if not row:
            json_response(self, 500, {"ok": False, "error": "Could not save point."})
            return
        json_response(self, 200, {
            "ok": True,
            "id":  row.get("id"),
            "expires_at_at_save": sess["expires_at"],
        })

    # ── action: my-points ─────────────────────────────────────────────
    def _my_points(self, sb, sess: dict):
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
        _touch_session(sb, sess["id"])
        json_response(self, 200, {
            "ok":         True,
            "points":     pts,
            "expires_at": sess["expires_at"],
        })

    # ── action: heartbeat ─────────────────────────────────────────────
    def _heartbeat(self, sb, sess: dict):
        _touch_session(sb, sess["id"])
        fresh = _load_session(sb, sess["id"]) or sess
        json_response(self, 200, {
            "ok":         True,
            "name":       fresh["name"],
            "expires_at": fresh["expires_at"],
        })
