"""api/_email_logic — three email actions imported by api/daily-refresh.

Underscore-prefixed so Vercel does NOT treat this file as a serverless
function (we already sit at the Hobby plan's 12-function ceiling).
api/daily-refresh.py forwards POST requests with ?action=invite,
?action=my-report or ?action=daily-report to dispatch() below.

Email delivery (preference order, first available wins):
  1. Gmail SMTP — requires GMAIL_USER + GMAIL_APP_PASSWORD env vars.
     Free up to 500/day. Sends to ANY recipient. Recommended for
     small-team / single-PI use where you don't own a verified domain.
  2. Resend — requires RESEND_API_KEY env var. With `onboarding@resend.dev`
     (default) delivery is constrained to the Resend account owner; with
     a verified domain (FROM_EMAIL env var) any recipient works.
"""
from __future__ import annotations

import base64
import hmac
import io
import json
import os
import re
import smtplib
import sys
import pathlib
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta, date
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate, make_msgid
from http.server import BaseHTTPRequestHandler
from typing import Any

sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import (  # type: ignore
    json_response,
    require_admin,
    require_auth,
    supabase_admin,
    supabase_anon,
    authed_supabase,
)

RESEND_API = "https://api.resend.com/emails"
# From-address policy:
#   - If FROM_EMAIL env var is set (operator verified a domain on Resend),
#     use it. Allows real branded sender once the project owns a domain.
#   - Otherwise default to Resend's free test sender `onboarding@resend.dev`
#     which works without any domain verification but ONLY delivers to the
#     account-owner email registered at resend.com. Good for the single-PI
#     daily-report use case where the only recipient is the admin.
DEFAULT_FROM = os.environ.get("FROM_EMAIL") or "KeyStone Field <onboarding@resend.dev>"


# ── Resend wrapper ──────────────────────────────────────────────────────────
def _send_via_resend(*, to: list[str], subject: str, text: str,
                    attachments: list[dict] | None = None) -> tuple[bool, str]:
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        return False, "RESEND_API_KEY not configured"
    body: dict[str, Any] = {
        "from": DEFAULT_FROM,
        "to": [a for a in to if a],
        "subject": subject,
        "text": text,
    }
    if attachments:
        body["attachments"] = attachments
    if not body["to"]:
        return False, "No recipients"
    req = urllib.request.Request(
        RESEND_API,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # Resend sits behind Cloudflare which 1010s requests with the
            # default `Python-urllib/3.x` UA. Send a legitimate UA so the
            # API call isn't bot-blocked.
            "User-Agent": "KeyStone-Field/1.0 (+https://keystone-project-survey-blue.vercel.app)",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status < 300, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}"
    except Exception as e:  # pragma: no cover
        return False, f"{type(e).__name__}"


# ── Gmail SMTP wrapper ─────────────────────────────────────────────────────
# Used when GMAIL_USER + GMAIL_APP_PASSWORD are configured. Sends mail
# from a dedicated Gmail account (e.g. surveydashboardreport@gmail.com)
# directly via smtp.gmail.com:587 with STARTTLS. Gmail rewrites the
# envelope sender to GMAIL_USER for anti-spoofing — the visible From
# header keeps a friendly display name but the address is GMAIL_USER.
def _send_via_gmail_smtp(*, to: list[str], subject: str, text: str,
                        attachments: list[dict] | None = None) -> tuple[bool, str]:
    user = os.environ.get("GMAIL_USER", "").strip()
    pwd  = os.environ.get("GMAIL_APP_PASSWORD", "").strip().replace(" ", "")
    if not user or not pwd:
        return False, "GMAIL_USER / GMAIL_APP_PASSWORD not configured"
    recipients = [a for a in to if a]
    if not recipients:
        return False, "No recipients"

    msg = MIMEMultipart()
    # Display name "KeyStone Field" with the dedicated Gmail as the
    # actual address. Recipients see "KeyStone Field <user@gmail.com>"
    # and replies route to the project inbox, not the admin's personal one.
    msg["From"] = formataddr(("KeyStone Field", user))
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=False)
    msg["Message-ID"] = make_msgid(domain="gmail.com")
    msg.attach(MIMEText(text, "plain", "utf-8"))

    for att in (attachments or []):
        filename = att.get("filename") or "attachment.bin"
        content_b64 = att.get("content") or ""
        if not content_b64:
            continue
        try:
            content_bytes = base64.b64decode(content_b64)
        except Exception:
            continue
        # Use MIMEApplication so it inherits Content-Transfer-Encoding: base64
        # and pick the most permissive subtype — Gmail doesn't validate the
        # MIME type strictly here. Filename attaches the content-disposition.
        part = MIMEApplication(content_bytes, _subtype="octet-stream")
        part.add_header("Content-Disposition", "attachment",
                        filename=filename)
        msg.attach(part)

    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=20) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.ehlo()
            smtp.login(user, pwd)
            smtp.sendmail(user, recipients, msg.as_string())
        return True, f"Sent via Gmail SMTP from {user} to {len(recipients)} recipient(s)"
    except smtplib.SMTPAuthenticationError as e:
        return False, f"Gmail SMTP auth failed: {e.smtp_code} {e.smtp_error.decode('utf-8','replace')[:200] if isinstance(e.smtp_error, bytes) else str(e.smtp_error)[:200]}"
    except smtplib.SMTPException as e:  # pragma: no cover
        return False, f"Gmail SMTP error: {type(e).__name__}: {str(e)[:200]}"
    except Exception as e:  # pragma: no cover
        return False, f"Gmail SMTP failed: {type(e).__name__}: {str(e)[:200]}"


# ── Email dispatcher ───────────────────────────────────────────────────────
# Single entry point used by all _handle_* functions. Picks Gmail SMTP
# if GMAIL_APP_PASSWORD is set; otherwise falls through to Resend.
# Matches `_send_via_resend`'s signature exactly so callers don't change.
def _send_email(*, to: list[str], subject: str, text: str,
                attachments: list[dict] | None = None) -> tuple[bool, str]:
    if os.environ.get("GMAIL_APP_PASSWORD", "").strip():
        ok, info = _send_via_gmail_smtp(to=to, subject=subject, text=text, attachments=attachments)
        # If Gmail attempt clearly failed at the auth step, still try Resend
        # as a fallback so a single misconfigured app-password doesn't kill
        # all outbound mail. Successful sends short-circuit.
        if ok:
            return ok, info
        if os.environ.get("RESEND_API_KEY", "").strip():
            ok2, info2 = _send_via_resend(to=to, subject=subject, text=text, attachments=attachments)
            return ok2, f"{info2} (Gmail fallback: {info})"
        return ok, info
    return _send_via_resend(to=to, subject=subject, text=text, attachments=attachments)


# ── XLSX builder (uses openpyxl, already in requirements.txt) ──────────────
def _build_xlsx(sheet_name: str, headers: list[str],
                rows: list[list[Any]]) -> bytes:
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_name[:31] or "Sheet1"
    ws.append(headers)
    for r in rows:
        ws.append([_xlsx_safe(v) for v in r])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _xlsx_safe(v: Any) -> Any:
    if v is None:
        return ""
    if isinstance(v, (str, int, float, bool)):
        return v
    return str(v)


def _b64(blob: bytes) -> str:
    import base64
    return base64.b64encode(blob).decode("ascii")


# ── Email validation ───────────────────────────────────────────────────────
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _is_email(s: str | None) -> bool:
    return bool(s and _EMAIL_RE.match(s.strip()))


# ── Origin helpers ─────────────────────────────────────────────────────────
def _origin(handler: BaseHTTPRequestHandler) -> str:
    host = handler.headers.get("Host") or "keystonesurvey.com"
    proto = handler.headers.get("X-Forwarded-Proto") or "https"
    return f"{proto}://{host}"


# ── action=invite : admin sends member-invite email ────────────────────────
def _handle_invite(self: "handler", body: dict) -> None:
    uid = require_admin(self)
    if uid is None:
        return
    target_email = (body.get("email") or "").strip().lower()
    if not _is_email(target_email):
        return json_response(self, 400, {"detail": "Valid email required."})
    # IMPORTANT: create_member_invite is SECURITY DEFINER and reads
    # auth.uid() to verify the caller is_admin(). Calling it via the
    # service-role client produces auth.uid()=NULL and the RPC rebuffs
    # with "Admin role required". Use the authenticated client (caller's
    # JWT propagated to PostgREST) so auth.uid() resolves to the admin.
    sb = authed_supabase(self) or supabase_admin()
    if not sb:
        return json_response(self, 503, {"detail": "Supabase unavailable."})
    # Create the invite via SECURITY DEFINER RPC.
    try:
        rpc = sb.rpc("create_member_invite", {"p_email": target_email}).execute()
        rec = (rpc.data or {}) if hasattr(rpc, "data") else {}
    except Exception as e:
        return json_response(self, 500, {"detail": f"Invite RPC failed: {type(e).__name__}"})
    if not rec.get("ok"):
        return json_response(self, 400, {"detail": rec.get("error") or "Invite RPC error"})
    token = rec.get("token") or ""
    invite_id = rec.get("id") or ""
    expires_at = rec.get("expires_at") or ""
    signup_url = f"{_origin(self)}/login?invite={token}&email={urllib.parse.quote(target_email)}"
    subject = "You're invited to KeyStone Field — DTSC Lab, University of Florida"
    text = (
        f"Hello,\n\n"
        f"An administrator of the KeyStone Heights Indoor Air Quality survey has invited you to "
        f"join the team as a member.\n\n"
        f"To accept this invitation:\n"
        f"  1. Open the secure link below.\n"
        f"  2. Create a password for your account ({target_email}).\n"
        f"  3. You'll be promoted to a team member automatically.\n\n"
        f"Sign-up link (expires in 14 days):\n"
        f"{signup_url}\n\n"
        f"If you did not expect this invitation you can safely ignore this email.\n\n"
        f"— KeyStone Field, DTSC Lab\n"
        f"  University of Florida\n"
    )
    ok, msg = _send_email(to=[target_email], subject=subject, text=text)
    if ok:
        try:
            sb.rpc("mark_invite_sent", {"p_id": invite_id}).execute()
        except Exception:
            pass
        return json_response(self, 200, {
            "ok": True,
            "email": target_email,
            "expires_at": expires_at,
        })
    return json_response(self, 502, {"detail": "Email send failed.", "info": msg[:200]})


# ── action=my-report : authenticated user emails their own data export ─────
def _handle_my_report(self: "handler", body: dict) -> None:
    target = (body.get("target_email") or "").strip().lower()
    if not _is_email(target):
        return json_response(self, 400, {"detail": "Valid target email required."})
    sb = supabase_admin()
    if not sb:
        return json_response(self, 503, {"detail": "Supabase unavailable."})
    # Either an authenticated team member (Bearer JWT) OR a guest with an
    # active guest_session_id is allowed. Each path can only export the
    # rows it owns — never another surveyor's data.
    uid = None
    gsid = (body.get("guest_session_id") or "").strip()
    full_name = "Surveyor"
    auth_header = self.headers.get("Authorization") or ""
    if auth_header.lower().startswith("bearer "):
        uid = require_auth(self)
        if uid is None:
            return  # response already written
    elif gsid:
        # Validate the guest session against the field_guest_sessions table.
        try:
            r = sb.table("field_guest_sessions").select(
                "id,name,expires_at,revoked_at"
            ).eq("id", gsid).limit(1).execute()
            row = (r.data or [None])[0]
        except Exception:
            row = None
        if not row:
            return json_response(self, 401, {"detail": "Unknown guest session."})
        if row.get("revoked_at"):
            return json_response(self, 401, {"detail": "Guest session revoked."})
        exp = row.get("expires_at") or ""
        if exp and exp < datetime.now(timezone.utc).isoformat():
            return json_response(self, 401, {"detail": "Guest session expired."})
        full_name = (row.get("name") or "Surveyor")
    else:
        return json_response(self, 401, {"detail": "Authentication required."})
    # Fetch the caller's own field points only.
    field_rows: list = []
    try:
        q = sb.table("field_survey_points").select(
            "id,lat,lon,status,notes,collector_name,collected_at"
        )
        if uid:
            q = q.eq("collector_id", uid)
        else:
            q = q.eq("guest_session_id", gsid)
        fp = q.order("collected_at", desc=True).limit(5000).execute()
        field_rows = fp.data or []
    except Exception:
        field_rows = []
    # And any community_contacts the user owns (post-migration-19).
    cc_rows: list = []
    if uid:
        try:
            cc = sb.table("community_contacts").select(
                "id,address,status,status_detail,survey_date,notes,street_name,lat,lon,source,created_at"
            ).eq("added_by_user_id", uid).order("created_at", desc=True).limit(5000).execute()
            cc_rows = cc.data or []
        except Exception:
            cc_rows = []
    else:
        try:
            cc = sb.table("community_contacts").select(
                "id,address,status,status_detail,survey_date,notes,street_name,lat,lon,source,created_at"
            ).eq("added_by_guest_session_id", gsid).order(
                "created_at", desc=True
            ).limit(5000).execute()
            cc_rows = cc.data or []
        except Exception:
            cc_rows = []
    today_iso = datetime.now(timezone.utc).date().isoformat()
    today_count = sum(1 for r in field_rows
                      if (r.get("collected_at") or "").startswith(today_iso))
    if uid:
        try:
            u = sb.auth.admin.get_user_by_id(uid)
            u_email = (u.user.email if u and getattr(u, "user", None) else "") or ""
            u_meta = (u.user.user_metadata if u and getattr(u, "user", None) else None) or {}
            full_name = u_meta.get("full_name") or u_meta.get("name") or u_email or "Surveyor"
        except Exception:
            pass
    xlsx = _build_xlsx(
        "My Field Points",
        ["ID", "Status", "Lat", "Lon", "Notes", "Collected At"],
        [[r.get("id"), r.get("status"), r.get("lat"), r.get("lon"),
          r.get("notes"), r.get("collected_at")] for r in field_rows],
    )
    contacts_xlsx = _build_xlsx(
        "My Community Contacts",
        ["ID", "Address", "Status", "Detail", "Street", "Lat", "Lon", "Source", "Created At"],
        [[r.get("id"), r.get("address"), r.get("status"), r.get("status_detail"),
          r.get("street_name"), r.get("lat"), r.get("lon"),
          r.get("source"), r.get("created_at")] for r in cc_rows],
    )
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    subject = f"KeyStone — Your collected points ({today_str})"
    text = (
        f"Hello {full_name},\n\n"
        f"Attached is the data you have collected with the KeyStone Field app.\n\n"
        f"Summary:\n"
        f"  Field points (all time):     {len(field_rows)}\n"
        f"  Field points (today, UTC):   {today_count}\n"
        f"  Community contacts (yours):  {len(cc_rows)}\n\n"
        f"This export contains only the points YOU collected — no other surveyor's "
        f"data is included.\n\n"
        f"— KeyStone Field, DTSC Lab\n"
    )
    attachments = [
        {"filename": f"my_field_points_{today_str}.xlsx", "content": _b64(xlsx)},
        {"filename": f"my_community_contacts_{today_str}.xlsx", "content": _b64(contacts_xlsx)},
    ]
    ok, msg = _send_email(to=[target], subject=subject, text=text, attachments=attachments)
    if not ok:
        return json_response(self, 502, {"detail": "Email send failed.", "info": msg[:200]})
    return json_response(self, 200, {
        "ok": True,
        "to": target,
        "field_count": len(field_rows),
        "field_today": today_count,
        "contact_count": len(cc_rows),
    })


# ── action=daily-report : internal change-detected admin digest ───────────
def _cron_authorized(handler: BaseHTTPRequestHandler) -> bool:
    secret = os.environ.get("CRON_SECRET", "").strip()
    if not secret:
        return False
    got = (handler.headers.get("Authorization") or "").strip()
    # Constant-time comparison to prevent timing attacks against CRON_SECRET.
    return hmac.compare_digest(got, f"Bearer {secret}")


def _handle_daily_report(self: "handler", body: dict) -> None:
    # Either an admin clicked "Send now" (require_admin) OR cron with CRON_SECRET.
    cron_ok = _cron_authorized(self)
    admin_uid = None
    if not cron_ok:
        admin_uid = require_admin(self)
        if admin_uid is None:
            return
    sb = supabase_admin()
    if not sb:
        return json_response(self, 503, {"detail": "Supabase unavailable."})
    # Determine window: from the previous successful 'sent' or 'no_changes' run end.
    try:
        prev = sb.table("daily_report_runs").select(
            "window_end"
        ).in_("status", ["sent", "no_changes"]).order("run_at", desc=True).limit(1).execute()
        prev_rows = prev.data or []
    except Exception:
        prev_rows = []
    now_utc = datetime.now(timezone.utc)
    window_start = (
        prev_rows[0]["window_end"]
        if prev_rows and prev_rows[0].get("window_end")
        else (now_utc - timedelta(days=1)).isoformat()
    )
    window_end = now_utc.isoformat()
    # Recipients
    try:
        rr = sb.table("report_recipients").select(
            "email"
        ).eq("is_active", True).limit(50).execute()
        recipients = [r.get("email", "").strip() for r in (rr.data or []) if r.get("email")]
    except Exception:
        recipients = []
    # Detect changes
    def _count(table: str, col: str) -> int:
        try:
            r = sb.table(table).select("id", count="exact").gt(col, window_start).execute()
            return int(getattr(r, "count", 0) or 0)
        except Exception:
            return 0
    cc_added = _count("community_contacts", "created_at")
    cc_updated = _count("community_contacts", "updated_at")
    fp_added = _count("field_survey_points", "collected_at")
    iaq_added = _count("iaq_surveys", "created_at")
    iaq_updated = _count("iaq_surveys", "updated_at")
    total_changes = cc_added + cc_updated + fp_added + iaq_added + iaq_updated
    # Skip if no changes
    if total_changes == 0:
        try:
            sb.table("daily_report_runs").insert({
                "run_at": window_end,
                "window_start": window_start,
                "window_end": window_end,
                "status": "no_changes",
                "recipients": recipients,
                "community_added": 0,
                "community_updated": 0,
                "field_added": 0,
                "iaq_added": 0,
                "iaq_updated": 0,
            }).execute()
        except Exception:
            pass
        return json_response(self, 200, {"ok": True, "status": "no_changes"})
    if not recipients:
        try:
            sb.table("daily_report_runs").insert({
                "run_at": window_end,
                "window_start": window_start,
                "window_end": window_end,
                "status": "skipped",
                "error_message": "No active recipients",
            }).execute()
        except Exception:
            pass
        return json_response(self, 200, {"ok": True, "status": "skipped",
                                          "reason": "no_recipients"})
    # Build full database snapshots (every column the user requested).
    try:
        cc_all = sb.table("community_contacts").select("*").order(
            "created_at", desc=True
        ).limit(20000).execute().data or []
    except Exception:
        cc_all = []
    try:
        fp_all = sb.table("field_survey_points").select("*").order(
            "collected_at", desc=True
        ).limit(20000).execute().data or []
    except Exception:
        fp_all = []
    try:
        iaq_all = sb.table("iaq_surveys").select("*").order(
            "created_at", desc=True
        ).limit(20000).execute().data or []
    except Exception:
        iaq_all = []
    cc_headers = sorted({k for r in cc_all for k in r.keys()}) if cc_all else [
        "id", "address", "status", "lat", "lon", "source", "created_at"
    ]
    fp_headers = sorted({k for r in fp_all for k in r.keys()}) if fp_all else [
        "id", "lat", "lon", "status", "collector_name", "collected_at"
    ]
    iaq_headers = sorted({k for r in iaq_all for k in r.keys()}) if iaq_all else [
        "id", "street_name", "overall_risk", "created_at"
    ]
    contacts_xlsx = _build_xlsx(
        "Community + Field",
        cc_headers + ["__divider__"] + fp_headers,
        [[r.get(h) for h in cc_headers] + [""] + ["" for _ in fp_headers]
         for r in cc_all] +
        [[""] for _ in range(0)] +
        [[""] * len(cc_headers) + [""] + [r.get(h) for h in fp_headers]
         for r in fp_all],
    )
    iaq_xlsx = _build_xlsx(
        "IAQ Surveys",
        iaq_headers,
        [[r.get(h) for h in iaq_headers] for r in iaq_all],
    )
    today_str = now_utc.strftime("%Y-%m-%d")
    summary_lines = [
        f"KeyStone Heights — Daily Change Report",
        f"Window: {window_start}  →  {window_end}",
        "",
        f"Community contacts added:    {cc_added}",
        f"Community contacts updated:  {cc_updated}",
        f"Field points added:          {fp_added}",
        f"IAQ surveys added:           {iaq_added}",
        f"IAQ surveys updated:         {iaq_updated}",
        "",
        f"Total community + field rows in DB: {len(cc_all) + len(fp_all)}",
        f"Total IAQ surveys in DB:           {len(iaq_all)}",
        "",
        "Two attachments:",
        " 1. community_and_field — every community contact and field point ever recorded.",
        " 2. iaq_surveys         — every IAQ survey response ever recorded.",
        "",
        "— KeyStone Field, DTSC Lab",
    ]
    subject = f"KeyStone Daily Report — {today_str} ({total_changes} change{'s' if total_changes != 1 else ''})"
    attachments = [
        {"filename": f"keystone_community_field_{today_str}.xlsx", "content": _b64(contacts_xlsx)},
        {"filename": f"keystone_iaq_surveys_{today_str}.xlsx", "content": _b64(iaq_xlsx)},
    ]
    ok, msg = _send_email(
        to=recipients, subject=subject, text="\n".join(summary_lines),
        attachments=attachments,
    )
    status = "sent" if ok else "error"
    try:
        sb.table("daily_report_runs").insert({
            "run_at": window_end,
            "window_start": window_start,
            "window_end": window_end,
            "status": status,
            "recipients": recipients,
            "community_added": cc_added,
            "community_updated": cc_updated,
            "field_added": fp_added,
            "iaq_added": iaq_added,
            "iaq_updated": iaq_updated,
            "change_summary": {
                "window_start": window_start,
                "window_end": window_end,
                "totals": {
                    "community_added": cc_added,
                    "community_updated": cc_updated,
                    "field_added": fp_added,
                    "iaq_added": iaq_added,
                    "iaq_updated": iaq_updated,
                },
            },
            "error_message": None if ok else msg[:500],
        }).execute()
    except Exception:
        pass
    if not ok:
        return json_response(self, 502, {"detail": "Daily report send failed.",
                                          "info": msg[:200]})
    return json_response(self, 200, {
        "ok": True,
        "status": "sent",
        "recipients": recipients,
        "totals": {
            "community_added": cc_added,
            "community_updated": cc_updated,
            "field_added": fp_added,
            "iaq_added": iaq_added,
            "iaq_updated": iaq_updated,
        },
    })


# ── Public dispatch entrypoint ─────────────────────────────────────────────
# This module is imported by api/daily-refresh.py — it is NOT itself a
# Vercel route, hence the underscore-prefixed filename. dispatch() is
# called when daily-refresh sees ?action=invite|my-report|daily-report.
import urllib.parse  # noqa: E402  (kept here to localise the dependency)


def dispatch(handler_obj, action: str, body: dict) -> bool:
    """Return True if the action was handled (response written), else False."""
    a = (action or "").lower()
    if a == "invite":
        _handle_invite(handler_obj, body)
        return True
    if a == "my-report":
        _handle_my_report(handler_obj, body)
        return True
    if a == "daily-report":
        _handle_daily_report(handler_obj, body)
        return True
    return False
