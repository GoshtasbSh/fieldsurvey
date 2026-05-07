"""GET or POST /api/daily-refresh — scheduled merge of field_survey_points into
the cached community-contact GeoJSON blob.

Invoked by Vercel Cron (see vercel.json). Lightweight — no geopandas/fiona.
Heavy spatial analysis (parcel matching, STRtree) is performed once by the
local admin via scripts/ingest.py when new parcel or contact data arrives.

Protected by CRON_SECRET header when called from Vercel's scheduler.
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs
import json as _json
import os
import urllib.request as _urlreq
from zoneinfo import ZoneInfo

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import (
    supabase_admin, load_cached, json_response, empty_geojson, haversine_m,
    _bearer_jwt, supabase_anon, merge_preserve_analysis,
)
import hmac as _hmac

# Status colours — mirrors _processing.STATUS so the analysis blob is consistent
# with what IAQ and survey uploads produce. Kept inline to avoid pulling pandas.
_STATUS_COLORS = {
    "Completed":      "#10b981",
    "No Answer":      "#f97316",
    "Inaccessible":   "#ef4444",
    "Not Interested": "#8b5cf6",
    "Left Info":      "#3b82f6",
    "Vacant":         "#6b7280",
    "Follow Up":      "#06b6d4",
    "Other":          "#ec4899",
    "Unknown":        "#9ca3af",
}
LOCAL_TZ = ZoneInfo("America/New_York")


def _compute_analysis(features: list) -> dict:
    """Minimal contact-level analysis — same output shape as compute_contact_analysis()
    in _processing.py, but uses only stdlib so daily-refresh stays lightweight."""
    sc: dict = {}
    st_count: dict = {}
    st_status: dict = {}
    for f in features:
        s  = f["properties"].get("status", "Unknown")
        sn = f["properties"].get("street_name", "Unknown")
        sc[s] = sc.get(s, 0) + 1
        st_count[sn] = st_count.get(sn, 0) + 1
        if sn not in st_status:
            st_status[sn] = {}
        st_status[sn][s] = st_status[sn].get(s, 0) + 1
    total = len(features)
    comp  = sc.get("Completed", 0)
    return {
        "total_points":    total,
        "completion_rate": round(comp / total * 100, 1) if total else 0,
        "status_counts":   sc,
        "status_colors":   _STATUS_COLORS,
        "streets": [
            {"name": n, "count": c, "statuses": st_status.get(n, {})}
            for n, c in sorted(st_count.items(), key=lambda x: -x[1])
        ],
        "parcel_stats": {},
    }


def _field_row_to_feature(row: dict) -> dict | None:
    # NB: field_survey_points carries no address column — surveyors mark the
    # GPS point and add notes only. We deliberately do not surface any
    # address-like field here so a future SELECT extension can't leak PII
    # into the public dashboard blob.
    lon = row.get("lon")
    lat = row.get("lat")
    if lon is None or lat is None:
        return None  # skip rows with no valid coordinates
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "source": "field",
            "field_point_id": row.get("id"),
            "status": row.get("status") or "Unknown",
            "street_name": "Field Survey",  # mirrors app.py _field_pts_to_geojson_features
            "notes": row.get("notes") or "",
            "collector": row.get("collector_name"),
            "collector_id": row.get("collector_id"),
            "collected_at": row.get("collected_at"),
        },
    }


def _run_refresh() -> dict:
    sb = supabase_admin()
    if not sb:
        return {"refreshed": False, "reason": "Supabase service role key not configured"}

    # Last snapshot timestamp
    try:
        versions = (
            sb.table("keystone_analysis_versions")
            .select("created_at")
            .eq("data_type", "community_contact")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        last_at = versions.data[0]["created_at"] if versions.data else "2000-01-01T00:00:00Z"
    except Exception as e:
        return {"refreshed": False, "reason": f"Could not read versions: {e}"}

    # New field points since then — paginate to avoid silent 1000-row PostgREST cap.
    cap_reached = False
    try:
        new_rows: list = []
        PAGE = 1000
        HARD_CAP = 100_000
        offset = 0
        while offset < HARD_CAP:
            page = (
                sb.table("field_survey_points")
                .select("id, lat, lon, status, notes, collector_id, collector_name, collected_at")
                .gt("collected_at", last_at)
                .range(offset, offset + PAGE - 1)
                .execute()
            ).data or []
            if not page:
                break
            new_rows.extend(page)
            if len(page) < PAGE:
                break
            offset += PAGE
        cap_reached = offset >= HARD_CAP and len(new_rows) >= HARD_CAP
        if cap_reached:
            print(f"[daily-refresh] WARNING: field_survey_points capped at {HARD_CAP} rows — "
                  "points beyond this limit were NOT merged. Investigate if table is large.")
    except Exception as e:
        return {"refreshed": False, "reason": f"Could not read field points: {e}"}

    # NOTE: even when no new field rows have arrived since the last
    # snapshot we still fall through and re-run the IAQ matcher against
    # the cached blob. Reason: the v3 matcher used to skip Completed
    # field pins, so any Completed pins added historically may still be
    # missing has_iaq_survey + iaq_matched. This idempotent re-pass
    # backfills them. We only persist + version-snapshot when something
    # actually changed (n_iaq_upgraded > 0 OR new_rows > 0 OR iaq blob
    # flipped) so unchanged invocations remain a no-op.

    # Load existing cached community-contact blob and append.
    # NB: must use 'community_contact' — the data_type every read endpoint queries.
    # (Earlier versions used 'survey_points', which was a dead key.)
    existing = load_cached("community_contact") or empty_geojson()
    features = list(existing.get("features") or [])
    new_features = [f for f in (_field_row_to_feature(r) for r in new_rows) if f is not None]

    # Upgrade new field points that have a Qualtric IAQ survey for the
    # SAME parcel. v3 (2026-05-05): use _processing.load_parcel_index +
    # _apply_iaq_to_field_features so daily-refresh and upload share the
    # exact same parcel-aware logic. Falls back to a tight 30 m haversine
    # if the parcel index can't be built (e.g. cached blob missing).
    iaq_stored = load_cached("iaq_survey") or {}
    iaq_feats = (iaq_stored.get("geojson") or {}).get("features") or []
    n_iaq_upgraded = 0
    # Snapshot iaq_matched per IAQ feature so we can detect downstream
    # flips and persist the iaq_survey blob only when something changed.
    iaq_matched_before = [bool((f.get("properties") or {}).get("iaq_matched"))
                          for f in iaq_feats]
    # Append new rows BEFORE running the matcher — we want the matcher
    # to also re-evaluate pre-existing field points (e.g. yesterday's
    # Completed pins that the buggy v3 matcher skipped) so they finally
    # pick up has_iaq_survey + iaq_matched. The matcher is idempotent.
    features.extend(new_features)
    field_features_for_match = [
        f for f in features
        if (f.get("properties") or {}).get("source") == "field"
    ]
    if iaq_feats and field_features_for_match:
        try:
            # Late import: keeps the daily-refresh function bundle slim
            # when the IAQ blob is empty (no upgrade work to do).
            from _processing import load_parcel_index, _apply_iaq_to_field_features
            parcel_idx = load_parcel_index()
            n_iaq_upgraded = _apply_iaq_to_field_features(
                field_features_for_match, iaq_feats, parcel_idx=parcel_idx)
        except Exception as e:
            print(f"[daily-refresh] parcel-aware match unavailable ({e}); "
                  f"falling back to 30 m distance.")
            for ff in field_features_for_match:
                if ff["properties"].get("has_iaq_survey"):
                    continue
                f_lon, f_lat = ff["geometry"]["coordinates"]
                for iaq_f in iaq_feats:
                    i_lon, i_lat = iaq_f["geometry"]["coordinates"]
                    if haversine_m(f_lat, f_lon, i_lat, i_lon) <= 30:
                        ff["properties"]["status"] = "Completed"
                        ff["properties"]["has_iaq_survey"] = True
                        iaq_f["properties"]["iaq_matched"] = True
                        n_iaq_upgraded += 1
                        break

    merged = {"type": "FeatureCollection", "features": features}

    # Tag every Completed contact / field-as-feature with match_status
    # (G1 = matched, G2 = contact_only) so the desktop map's stroke
    # encoding stays correct after the daily-refresh append. Then dedup
    # at the parcel rep-point so a freshly-appended field point at the
    # same parcel as an existing CSV contact collapses to a single dot.
    try:
        from _processing import tag_contact_match_status, dedup_contacts_at_parcel
        tag_contact_match_status(features)
        features = dedup_contacts_at_parcel(features)
        merged = {"type": "FeatureCollection", "features": features}
    except Exception as e:
        print(f"[daily-refresh] tag/dedup failed: {e}")

    local_day = datetime.now(LOCAL_TZ).date().isoformat()
    label = f"Daily Update {local_day} — {len(new_rows)} new field visits ({len(features)} total)"

    # Persist iaq_survey blob if any iaq_matched flag flipped during the
    # field-point match pass. Without this, the IAQ-only dot keeps its
    # G3 yellow rim on the map even though a field pin now ground-truths
    # the parcel as 'matched' (G1, white rim).
    iaq_matched_after = [bool((f.get("properties") or {}).get("iaq_matched"))
                         for f in iaq_feats]
    iaq_blob_changed = (iaq_matched_before != iaq_matched_after)
    if iaq_blob_changed and iaq_stored:
        try:
            iaq_payload = dict(iaq_stored)
            geo = dict(iaq_payload.get("geojson") or {})
            geo["features"] = iaq_feats
            iaq_payload["geojson"] = geo
            sb.table("keystone_dashboard_data").upsert({
                "data_type": "iaq_survey",
                "payload": iaq_payload,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="data_type").execute()
        except Exception as e:
            print(f"[daily-refresh] iaq_survey blob persist failed: {e}")

    # Persist merged blob + version snapshot — but only when something
    # actually changed. Empty refresh ticks (no new rows AND no IAQ
    # backfill) skip the write so we don't churn the version table.
    something_changed = bool(new_rows) or n_iaq_upgraded > 0 or iaq_blob_changed
    if not something_changed:
        return {"refreshed": False, "reason": "No new field data and no IAQ backfill needed",
                "last_analysis": last_at}
    try:
        sb.table("keystone_dashboard_data").upsert({
            "data_type": "community_contact",
            "payload": merged,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="data_type").execute()
        sb.table("keystone_analysis_versions").insert({
            "data_type": "community_contact",
            "payload": merged,
            "label": label,
            "n_points": len(features),
        }).execute()
    except Exception as e:
        return {"refreshed": False, "reason": f"Write failed: {e}"}

    # Recompute and persist analysis stats so the dashboard's Analysis tab
    # reflects today's field-point additions rather than the last upload.
    # NB: scripts/ingest.py is the only thing that computes parcel_stats
    # (needs geopandas/shapely — too heavy for a Vercel function). We must
    # PRESERVE the previous analysis blob's parcel_stats and any other
    # server-only fields so the Parcels tab stays populated. Without this
    # merge, every daily-refresh tick wipes the parcel analysis.
    try:
        # Single shared helper now lives in _lib so the upload, restore,
        # and daily-refresh paths all preserve parcel_stats identically.
        recomputed = merge_preserve_analysis(_compute_analysis(features))
        sb.table("keystone_dashboard_data").upsert({
            "data_type": "analysis",
            "payload": recomputed,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="data_type").execute()
    except Exception as e:
        print(f"[daily-refresh] analysis recompute failed: {e}")

    return {"refreshed": True, "new_field_points": len(new_rows),
            "total_points": len(features), "label": label,
            "cap_reached": cap_reached}


def _cron_authorized(handler_obj) -> bool:
    """Bearer CRON_SECRET check. Constant-time. Fails closed if CRON_SECRET
    is unset — no environment-variable backdoors."""
    secret = os.environ.get("CRON_SECRET", "")
    if not secret:
        return False
    got = handler_obj.headers.get("authorization", "") or handler_obj.headers.get("Authorization", "")
    expected = f"Bearer {secret}"
    return _hmac.compare_digest(got or "", expected)


def _admin_authorized(handler_obj) -> bool:
    """Admin user-JWT check — used by the dashboard's "Run Daily Refresh
    Now" button. Validates the JWT and checks team_members.role='admin'."""
    jwt = _bearer_jwt(handler_obj)
    if jwt is None:
        return False
    sb_anon = supabase_anon()
    sb_adm  = supabase_admin()
    if sb_anon is None or sb_adm is None:
        return False
    try:
        resp = sb_anon.auth.get_user(jwt)
        user = getattr(resp, "user", None)
        uid = getattr(user, "id", None) if user else None
    except Exception:
        return False
    if not uid:
        return False
    try:
        r = sb_adm.table("team_members").select("role").eq("id", uid).limit(1).execute()
        rows = r.data or []
    except Exception:
        rows = []
    return bool(rows) and (rows[0].get("role") == "admin")


def _authorized(handler_obj) -> bool:
    return _cron_authorized(handler_obj) or _admin_authorized(handler_obj)


def _maybe_dispatch_email_action(handler_obj) -> bool:
    """If the request carries ?action=invite|my-report|daily-report,
    delegate to the email-logic module (kept underscore-prefixed so it
    is NOT counted against the Hobby 12-function cap). Returns True if
    handled (a response has been written)."""
    qs = parse_qs(urlparse(handler_obj.path).query)
    action = (qs.get("action", [""])[0] or "").lower()
    if not action:
        return False
    # Read body (POST). For GET we just pass an empty dict.
    body: dict = {}
    try:
        length = int(handler_obj.headers.get("Content-Length") or "0")
        if length > 0:
            raw = handler_obj.rfile.read(length)
            try:
                parsed = _json.loads(raw.decode("utf-8") or "{}")
                if isinstance(parsed, dict):
                    body = parsed
            except Exception:
                body = {}
    except Exception:
        body = {}
    try:
        from _email_logic import dispatch as _email_dispatch  # type: ignore
    except Exception:
        return False
    return bool(_email_dispatch(handler_obj, action, body))


class handler(BaseHTTPRequestHandler):
    def _handle(self):
        # ── Email-logic actions (invite / my-report / daily-report) ──
        # These come in BEFORE the refresh authorisation gate because
        # each handler does its own auth (admin JWT, user JWT, guest
        # session id, or cron bearer).
        qs = parse_qs(urlparse(self.path).query)
        action = (qs.get("action", [""])[0] or "").lower()
        mode = (qs.get("mode", [""])[0] or "").lower()
        if action in ("invite", "my-report", "daily-report"):
            if _maybe_dispatch_email_action(self):
                return
            json_response(self, 500, {"error": "email dispatch failed"})
            return
        if mode == "report":
            # Vercel cron triggers at 00:00 UTC (EDT) and 01:00 UTC (EST);
            # the local-time gate below picks exactly one per DST window.
            cron_ok = _cron_authorized(self)
            admin_ok = _admin_authorized(self)
            if not (cron_ok or admin_ok):
                json_response(self, 401, {"error": "unauthorized"})
                return
            if cron_ok and not admin_ok:
                now_local = datetime.now(LOCAL_TZ)
                if now_local.hour != 20:
                    json_response(self, 200, {
                        "report": False,
                        "reason": "outside Florida 20:00 local window",
                        "local_time": now_local.isoformat(),
                    })
                    return
            # Synthesize an action=daily-report request and delegate.
            try:
                from _email_logic import dispatch as _email_dispatch  # type: ignore
                _email_dispatch(self, "daily-report", {})
            except Exception as e:
                json_response(self, 500, {"error": f"{type(e).__name__}"})
            return
        cron_ok = _cron_authorized(self)
        admin_ok = _admin_authorized(self)
        if not (cron_ok or admin_ok):
            json_response(self, 401, {"error": "unauthorized"})
            return
        # Default: data refresh. Cron is scheduled at both 04:00 and 05:00
        # UTC so DST shifts still hit local midnight in Florida. Only the
        # invocation that is actually 00:00 local performs work.
        if cron_ok and not admin_ok:
            now_local = datetime.now(LOCAL_TZ)
            if now_local.hour != 0:
                json_response(self, 200, {
                    "refreshed": False,
                    "reason": "outside Florida local-midnight window",
                    "local_time": now_local.isoformat(),
                })
                return
        try:
            result = _run_refresh()
            json_response(self, 200, result)
        except Exception as e:
            json_response(self, 500, {"error": str(e)})

    def do_GET(self):  # Vercel Cron issues GET
        self._handle()

    def do_POST(self):  # Manual trigger during testing
        self._handle()
