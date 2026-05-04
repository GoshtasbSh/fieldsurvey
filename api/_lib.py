"""Shared helpers for KeyStone Vercel Python Functions.

Each api/*.py function imports this to get a Supabase client + JSON-reply
utilities. Kept dependency-light: only `supabase` + stdlib — no geopandas.
"""
from __future__ import annotations

import json
import os
from typing import Any

try:
    from supabase import create_client, Client
except ImportError:  # pragma: no cover — local-only fallback
    create_client = None  # type: ignore
    Client = None  # type: ignore


def supabase_admin() -> "Client | None":
    """Supabase client using the SERVICE ROLE key. Bypasses RLS.

    Only use for server-only reads/writes (e.g. daily-refresh, uploads).
    Returns None if env is missing so callers can gracefully degrade.
    """
    if not create_client:
        return None
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return None
    return create_client(url, key)


def supabase_anon() -> "Client | None":
    """Supabase client using the anon key. Respects RLS.

    Use for read-only endpoints that mirror the browser's capabilities.
    """
    if not create_client:
        return None
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_ANON_KEY", "")
    if not url or not key:
        return None
    return create_client(url, key)


def load_cached(data_type: str) -> dict | list | None:
    """Read a pre-computed blob from keystone_dashboard_data (precomputed by the
    local ingestion CLI — see scripts/ingest.py). Returns None if missing."""
    sb = supabase_admin() or supabase_anon()
    if not sb:
        return None
    try:
        r = sb.table("keystone_dashboard_data").select("payload").eq("data_type", data_type).execute()
        return r.data[0]["payload"] if r.data else None
    except Exception:
        return None


def json_response(handler, status: int, body: Any, *, cache: str = "no-store") -> None:
    """Write a JSON response on a BaseHTTPRequestHandler."""
    payload = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", cache)
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def empty_geojson() -> dict:
    return {"type": "FeatureCollection", "features": []}


# ── Authentication helpers ─────────────────────────────────────────────────

# Hard cap on request body size for upload endpoints. Bigger than any real
# Qualtrics or Excel export but small enough that a single function invocation
# can't be made to read megabytes of attacker-controlled bytes into memory.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB


# Per-respondent IAQ answer fields. Anonymous /api/iaq-points strips these
# from each feature's properties before responding so individual residents'
# answers (some of which are sensitive — calling law enforcement, insurance
# loss, open-text affordability strategy, etc.) never leak via the public
# endpoint. The auth-gated /api/iaq-points-full preserves them for signed-in
# dashboard users who need the per-question popup. Must mirror the keys in
# api/_processing.SURVEY_QUESTIONS.
SURVEY_ANSWER_FIELDS = (
    'years_in_hre',
    'reloc_factor_emp', 'reloc_factor_aff', 'reloc_factor_qol',
    'reloc_factor_fam', 'reloc_factor_ret', 'reloc_factor_env',
    'reloc_factor_inh', 'reloc_factor_oth',
    'mh_skirting', 'anticipated_stay',
    'safety_env', 'safety_social',
    'afford_urgency', 'afford_strategy',
    'intv_roof_walls', 'intv_windows_doors', 'intv_rain_gardens',
    'intv_hvac', 'intv_plumbing_elec', 'intv_well_septic',
    'intv_ccua_water', 'intv_fence', 'intv_trees_shade',
    'intv_trim_trees', 'intv_drainage',
    'exp_flooding', 'exp_flood_help', 'exp_extreme_heat', 'exp_school_change',
    'exp_law_enf', 'exp_insurance_loss', 'exp_well_dry',
    'exp_pests', 'exp_water_leaks', 'exp_loose_animals',
    'car_access', 'hurricane_transport',
    'education', 'employment',
)


def strip_survey_answers(geojson):
    """Return a deep-trimmed copy of an IAQ feature collection with the
    per-respondent SURVEY_ANSWER_FIELDS removed from every feature.
    The input dict is not mutated. Safe on empty / malformed inputs."""
    if not isinstance(geojson, dict):
        return geojson
    feats_in = geojson.get('features') or []
    if not isinstance(feats_in, list):
        return geojson
    feats_out = []
    keys = SURVEY_ANSWER_FIELDS
    for f in feats_in:
        if not isinstance(f, dict):
            feats_out.append(f); continue
        props = f.get('properties') or {}
        if not isinstance(props, dict):
            feats_out.append(f); continue
        new_props = {k: v for k, v in props.items() if k not in keys}
        feats_out.append({**f, 'properties': new_props})
    return {**geojson, 'features': feats_out}


def _bearer_jwt(handler) -> str | None:
    auth_header = handler.headers.get("Authorization", "") or ""
    if not auth_header.lower().startswith("bearer "):
        return None
    jwt = auth_header.split(" ", 1)[1].strip()
    return jwt or None


def require_auth(handler) -> str | None:
    """Verify the caller's Supabase JWT. Returns the user id on success, else None
    (and writes a 401 response). Use at the top of any mutating endpoint.

        user_id = require_auth(self)
        if user_id is None: return  # response already written
    """
    jwt = _bearer_jwt(handler)
    if jwt is None:
        json_response(handler, 401, {"detail": "Missing Bearer token."})
        return None
    sb = supabase_anon()
    if not sb:
        json_response(handler, 503, {"detail": "Auth service unavailable."})
        return None
    try:
        resp = sb.auth.get_user(jwt)
        user = getattr(resp, "user", None)
        uid = getattr(user, "id", None) if user else None
    except Exception:
        uid = None
    if not uid:
        json_response(handler, 401, {"detail": "Invalid or expired token."})
        return None
    return uid


def require_team_member(handler) -> tuple[str, str] | None:
    """Verify JWT + confirm the user is in `team_members`. Returns
    `(user_id, role)` on success, else None (and writes 401/403). Used
    by every read/write endpoint that should be team-only.
    """
    uid = require_auth(handler)
    if uid is None:
        return None
    sb = supabase_admin() or supabase_anon()
    if not sb:
        json_response(handler, 503, {"detail": "Auth service unavailable."})
        return None
    try:
        r = sb.table("team_members").select("role").eq("id", uid).limit(1).execute()
        rows = r.data or []
    except Exception:
        rows = []
    if not rows:
        json_response(handler, 403, {"detail": "Team membership required. Redeem your invite code."})
        return None
    role = (rows[0] or {}).get("role") or "member"
    return uid, role


def require_admin(handler) -> str | None:
    """Verify JWT + admin role. Returns user_id on success, else None
    (and writes 401/403)."""
    res = require_team_member(handler)
    if res is None:
        return None
    uid, role = res
    if role != "admin":
        json_response(handler, 403, {"detail": "Admin role required."})
        return None
    return uid


def authed_supabase(handler):
    """Return a Supabase client whose PostgREST requests carry the caller's
    JWT — used for SECURITY DEFINER RPCs that read `auth.uid()`. Caller is
    responsible for having already validated the JWT (e.g. via
    require_team_member). Returns None and writes 503 if env is missing."""
    jwt = _bearer_jwt(handler)
    if jwt is None:
        return None
    sb = supabase_anon()
    if not sb:
        return None
    try:
        sb.postgrest.auth(jwt)
    except Exception:
        return None
    return sb


def check_upload_size(handler, max_bytes: int = MAX_UPLOAD_BYTES) -> int | None:
    """Validate the Content-Length header. Returns the parsed length on success,
    else None (and writes a 4xx response)."""
    raw = handler.headers.get("Content-Length") or ""
    try:
        length = int(raw)
    except (TypeError, ValueError):
        json_response(handler, 400, {"detail": "Invalid Content-Length header."})
        return None
    if length < 0:
        json_response(handler, 400, {"detail": "Invalid Content-Length header."})
        return None
    if length > max_bytes:
        json_response(handler, 413, {
            "detail": f"Upload too large: {length} bytes (max {max_bytes}).",
        })
        return None
    return length


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in metres between two WGS-84 lat/lon points."""
    from math import radians, sin, cos, sqrt, atan2
    R = 6_371_000
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))
