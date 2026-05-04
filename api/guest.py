"""POST /api/guest — ephemeral guest-surveyor proxy.

Body: {"action": <action>, ...}

Actions:
  claim       — name + today's invite code → returns session_id, expires_at
  heartbeat   — session_id → keep-alive (sliding TTL)
  add-point   — session_id + lat/lon/status/notes → insert field_survey_points
  edit-point  — session_id + point_id + status/notes → update OWN pin only
  delete-point— session_id + point_id → delete OWN pin only
  my-points   — session_id → guest's own pins
  points-all  — session_id → all team field_survey_points (for the map)
  team-list   — session_id → recent points + presence (for renderTeam)
  chat-list   — session_id → today's team_chat_messages
  chat-send   — session_id + body → insert team_chat_message as guest
  chat-poll   — session_id + since_id (optional) → only newer messages

Single Vercel function — all action dispatch happens via the body's
`action` field. Stays inside the Hobby plan's 12-function cap.

Auth: NONE for `claim` (guests have no Supabase account).
      Validated session_id for everything else.
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
        if action == "edit-point":
            return self._edit_point(body, sb, sess)
        if action == "delete-point":
            return self._delete_point(body, sb, sess)
        if action == "my-points":
            return self._my_points(sb, sess)
        if action == "heartbeat":
            return self._heartbeat(sb, sess)
        if action == "points-all":
            return self._points_all(sb, sess)
        if action == "team-list":
            return self._team_list(sb, sess)
        if action == "chat-list":
            return self._chat_list(sb, sess)
        if action == "chat-poll":
            return self._chat_poll(body, sb, sess)
        if action == "chat-send":
            return self._chat_send(body, sb, sess)
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

    # ── action: edit-point ────────────────────────────────────────────
    # Guest may only edit a pin THEY collected (matched on guest_session_id).
    # Service-role bypasses RLS, so we must enforce ownership ourselves.
    def _edit_point(self, body: dict, sb, sess: dict):
        point_id = (body.get("point_id") or "").strip()
        if not point_id:
            json_response(self, 400, {"ok": False, "error": "point_id required."})
            return
        # Ownership check: load the row, refuse if guest_session_id mismatch.
        try:
            r = (sb.table("field_survey_points")
                   .select("id,guest_session_id")
                   .eq("id", point_id).limit(1).execute())
            rows = r.data or []
        except Exception as e:
            print(f"[guest/edit-point] read FAIL {type(e).__name__}: {e}")
            json_response(self, 500, {"ok": False, "error": "Could not read point."})
            return
        if not rows:
            json_response(self, 404, {"ok": False, "error": "Point not found."})
            return
        if rows[0].get("guest_session_id") != sess["id"]:
            json_response(self, 403, {"ok": False, "error": "You can only edit pins you collected."})
            return
        # Build the update patch — only touch fields the guest is allowed to change.
        patch: dict = {}
        if "status" in body:
            status = (body.get("status") or "Unknown").strip()
            if status not in ALLOWED_STATUS:
                json_response(self, 400, {"ok": False, "error": "Invalid status."})
                return
            patch["status"] = status
        if "notes" in body:
            notes = (body.get("notes") or "").strip()
            if len(notes) > 1000:
                notes = notes[:1000]
            patch["notes"] = notes or None
        if not patch:
            json_response(self, 400, {"ok": False, "error": "Nothing to update."})
            return
        try:
            sb.table("field_survey_points").update(patch).eq("id", point_id).execute()
        except Exception as e:
            print(f"[guest/edit-point] update FAIL {type(e).__name__}: {e}")
            json_response(self, 500, {"ok": False, "error": "Could not update point."})
            return
        _touch_session(sb, sess["id"])
        json_response(self, 200, {"ok": True, "id": point_id})

    # ── action: delete-point ──────────────────────────────────────────
    def _delete_point(self, body: dict, sb, sess: dict):
        point_id = (body.get("point_id") or "").strip()
        if not point_id:
            json_response(self, 400, {"ok": False, "error": "point_id required."})
            return
        try:
            r = (sb.table("field_survey_points")
                   .select("id,guest_session_id")
                   .eq("id", point_id).limit(1).execute())
            rows = r.data or []
        except Exception as e:
            print(f"[guest/delete-point] read FAIL {type(e).__name__}: {e}")
            json_response(self, 500, {"ok": False, "error": "Could not read point."})
            return
        if not rows:
            # Idempotent: missing row is treated as already-deleted.
            json_response(self, 200, {"ok": True, "id": point_id, "missing": True})
            return
        if rows[0].get("guest_session_id") != sess["id"]:
            json_response(self, 403, {"ok": False, "error": "You can only delete pins you collected."})
            return
        try:
            sb.table("field_survey_points").delete().eq("id", point_id).execute()
        except Exception as e:
            print(f"[guest/delete-point] delete FAIL {type(e).__name__}: {e}")
            json_response(self, 500, {"ok": False, "error": "Could not delete point."})
            return
        _touch_session(sb, sess["id"])
        json_response(self, 200, {"ok": True, "id": point_id})

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

    # ── action: points-all (every team field_survey_point) ────────────
    def _points_all(self, sb, sess: dict):
        try:
            rows: list = []
            PAGE = 1000
            HARD_CAP = 50_000
            offset = 0
            while offset < HARD_CAP:
                page = (sb.table("field_survey_points")
                          .select("id,lat,lon,status,notes,collector_id,collector_name,guest_session_id,collected_at")
                          .order("collected_at", desc=True)
                          .range(offset, offset + PAGE - 1)
                          .execute().data) or []
                if not page:
                    break
                rows.extend(page)
                if len(page) < PAGE:
                    break
                offset += PAGE
        except Exception as e:
            print(f"[guest/points-all] read FAIL {type(e).__name__}: {e}")
            json_response(self, 500, {"ok": False, "error": "Could not load points."})
            return
        _touch_session(sb, sess["id"])
        json_response(self, 200, {"ok": True, "points": rows})

    # ── action: team-list (collector breakdown + presence) ────────────
    def _team_list(self, sb, sess: dict):
        try:
            pts_q = (sb.table("field_survey_points")
                       .select("collector_id,collector_name,status,collected_at")
                       .order("collected_at", desc=True)
                       .limit(5000)
                       .execute())
            pres_q = (sb.table("user_presence")
                        .select("user_id,display_name,last_active_at")
                        .order("last_active_at", desc=True)
                        .execute())
            pts      = pts_q.data or []
            presence = pres_q.data or []
        except Exception as e:
            print(f"[guest/team-list] read FAIL {type(e).__name__}: {e}")
            json_response(self, 500, {"ok": False, "error": "Could not load team activity."})
            return
        _touch_session(sb, sess["id"])
        json_response(self, 200, {
            "ok":       True,
            "points":   pts,
            "presence": presence,
        })

    # ── action: chat-list (today's team chat messages) ────────────────
    def _chat_list(self, sb, sess: dict):
        try:
            today_utc = datetime.now(timezone.utc).date().isoformat()
            r = (sb.table("team_chat_messages")
                   .select("id,user_id,display_name,body,sent_at,attachment_url,attachment_type,guest_session_id")
                   .gte("sent_at", today_utc + "T00:00:00Z")
                   .order("sent_at", desc=False)
                   .limit(500)
                   .execute())
            msgs = r.data or []
        except Exception as e:
            print(f"[guest/chat-list] read FAIL {type(e).__name__}: {e}")
            json_response(self, 500, {"ok": False, "error": "Could not load chat."})
            return
        _touch_session(sb, sess["id"])
        json_response(self, 200, {"ok": True, "messages": msgs})

    # ── action: chat-poll (only messages newer than since_id) ─────────
    def _chat_poll(self, body: dict, sb, sess: dict):
        since = (body.get("since_sent_at") or "").strip()
        try:
            today_utc = datetime.now(timezone.utc).date().isoformat()
            q = (sb.table("team_chat_messages")
                   .select("id,user_id,display_name,body,sent_at,attachment_url,attachment_type,guest_session_id")
                   .gte("sent_at", today_utc + "T00:00:00Z")
                   .order("sent_at", desc=False)
                   .limit(500))
            if since:
                q = q.gt("sent_at", since)
            r = q.execute()
            msgs = r.data or []
        except Exception as e:
            print(f"[guest/chat-poll] read FAIL {type(e).__name__}: {e}")
            json_response(self, 500, {"ok": False, "error": "Could not poll chat."})
            return
        _touch_session(sb, sess["id"])
        json_response(self, 200, {"ok": True, "messages": msgs})

    # ── action: chat-send (guest posts a chat message) ────────────────
    def _chat_send(self, body: dict, sb, sess: dict):
        text = (body.get("body") or "").strip()
        if not text:
            json_response(self, 400, {"ok": False, "error": "Empty message."})
            return
        if len(text) > 1000:
            text = text[:1000]
        try:
            r = (sb.table("team_chat_messages").insert({
                "user_id":          None,
                "display_name":     sess["name"],
                "body":             text,
                "guest_session_id": sess["id"],
            }).execute())
            row = (r.data or [None])[0]
        except Exception as e:
            print(f"[guest/chat-send] insert FAIL {type(e).__name__}: {e}")
            json_response(self, 500, {"ok": False, "error": "Could not send message."})
            return
        _touch_session(sb, sess["id"])
        if not row:
            json_response(self, 500, {"ok": False, "error": "Could not send message."})
            return
        json_response(self, 200, {"ok": True, "message": row})
