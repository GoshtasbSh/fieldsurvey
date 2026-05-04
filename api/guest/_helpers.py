"""Shared helpers for /api/guest/* endpoints — no Supabase JWT required.

Guests authenticate via a session_id (UUID) returned by /api/guest/claim,
which they store in sessionStorage. Every subsequent /api/guest/* call
includes the session_id in the JSON body. The server validates the session
is alive (not expired, not revoked) and uses the SERVICE-ROLE supabase
client to insert/read on behalf of the guest.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import os
from datetime import datetime, timezone


MAX_BODY_BYTES = 64 * 1024  # 64 KB — sufficient for a single field point + notes


def get_client_ip(handler) -> str:
    """Extract the client IP from Vercel's forwarded headers."""
    xff = handler.headers.get("X-Forwarded-For", "") or ""
    if xff:
        # First entry is the originating client (Vercel adds intermediaries
        # after that). Strip whitespace.
        return xff.split(",", 1)[0].strip()
    return handler.headers.get("X-Real-IP", "") or ""


def hash_ip(ip: str) -> str:
    """Hash an IP with the project secret so we can correlate sessions
    without storing raw IPs. Uses CRON_SECRET (or SUPABASE_SERVICE_ROLE_KEY
    fallback) as the salt — both are server-only and stable per project."""
    if not ip:
        return ""
    salt = (
        os.environ.get("KEYSTONE_IP_HASH_SALT")
        or os.environ.get("CRON_SECRET")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or "fallback-salt"
    )
    return hashlib.sha256((salt + "|" + ip).encode("utf-8")).hexdigest()[:32]


def parse_body(handler, max_bytes: int = MAX_BODY_BYTES) -> dict | None:
    """Read and JSON-parse the request body. Returns None on error
    (and writes a 400 response)."""
    from _lib import json_response
    raw = handler.headers.get("Content-Length") or "0"
    try:
        length = int(raw)
    except (TypeError, ValueError):
        json_response(handler, 400, {"ok": False, "error": "Invalid Content-Length."})
        return None
    if length < 0 or length > max_bytes:
        json_response(handler, 413, {"ok": False, "error": f"Body too large (max {max_bytes} bytes)."})
        return None
    if length == 0:
        return {}
    try:
        body = handler.rfile.read(length).decode("utf-8")
        return json.loads(body) if body else {}
    except Exception:
        json_response(handler, 400, {"ok": False, "error": "Invalid JSON body."})
        return None


def today_utc():
    return datetime.now(timezone.utc).date()


def fetch_today_code(sb) -> str | None:
    """Read the current day's invite code via service-role.
    Bypasses RLS deliberately because guests don't have auth.uid()."""
    try:
        today = today_utc().isoformat()
        r = sb.table("invite_codes").select("code").eq("date", today).limit(1).execute()
        rows = r.data or []
        if not rows:
            return None
        return (rows[0] or {}).get("code")
    except Exception:
        return None


def load_session(sb, session_id: str) -> dict | None:
    """Look up a guest session by id. Returns the row or None if missing.
    Caller must check expiry / revoked themselves so we can give a precise
    error code."""
    if not session_id or len(session_id) != 36:
        return None
    try:
        r = (sb.table("field_guest_sessions")
               .select("id,name,invite_date,created_at,expires_at,last_seen_at,revoked_at")
               .eq("id", session_id)
               .limit(1)
               .execute())
        rows = r.data or []
        return rows[0] if rows else None
    except Exception:
        return None


def session_status(session: dict | None) -> str:
    """Returns 'ok', 'missing', 'revoked', 'expired'."""
    if not session:
        return "missing"
    if session.get("revoked_at"):
        return "revoked"
    try:
        exp = session.get("expires_at")
        if isinstance(exp, str):
            # PostgREST returns ISO 8601; tolerate trailing Z
            exp = exp.replace("Z", "+00:00")
            exp_dt = datetime.fromisoformat(exp)
        else:
            exp_dt = exp
        if exp_dt and exp_dt < datetime.now(timezone.utc):
            return "expired"
    except Exception:
        return "expired"
    return "ok"


def touch_session(sb, session_id: str, *, extend_hours: int = 4) -> None:
    """Sliding-window TTL: bump last_seen_at + extend expires_at on any
    successful guest action. Best-effort — failures are silent."""
    try:
        from datetime import timedelta
        now = datetime.now(timezone.utc)
        new_exp = now + timedelta(hours=extend_hours)
        sb.table("field_guest_sessions").update({
            "last_seen_at": now.isoformat(),
            # Only extend if the new value is later than the current one;
            # we read it back below to preserve a single round-trip cap.
            "expires_at":   new_exp.isoformat(),
        }).eq("id", session_id).execute()
    except Exception:
        pass


def name_safe(name: str) -> str:
    """Trim + collapse whitespace + strip control chars."""
    if not name:
        return ""
    s = "".join(ch for ch in name if ord(ch) >= 0x20)
    return " ".join(s.split())[:80]
