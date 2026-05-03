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


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in metres between two WGS-84 lat/lon points."""
    from math import radians, sin, cos, sqrt, atan2
    R = 6_371_000
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))
