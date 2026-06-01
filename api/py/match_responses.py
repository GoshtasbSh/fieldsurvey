"""
FieldSurvey response matcher — Python serverless function.

Algorithm (memorized in project_fieldsurvey_matching_algorithm.md):
  1. For each survey_response row missing geocoded coords:
       - Read the address from `address_used` (column chosen by import wizard).
         NEVER use the response's own lat/lon — surveys are filled anywhere.
       - Geocode via U.S. Census Bureau geocoder (free, no key).
       - Persist geocoded_lat / geocoded_lon / address_used / geocode_source.
  2. For each ungeoded response with geocoded coords, find a `points` row in
     the same project within `project_settings.match_radius_m` (default 30m,
     Keystone parity). If found:
       - Set survey_responses.point_id, match_distance_m, matched_at.
       - Set points.matched_response_id.
  3. Return a summary: { matched, field_only, response_only, ambiguous }.

  match_status is NEVER stored. It is derived by v_match_status (migration
  002) on every read. Re-running this matcher is idempotent.

Invoked via POST /api/py/match-responses?project_id=...
Auth: SUPABASE_SERVICE_ROLE_KEY in env. Caller MUST be project owner/admin
(checked at the Next.js shim that calls into this function).
"""
from http.server import BaseHTTPRequestHandler
import json
import math
import os
import urllib.parse
import urllib.request


SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SERVICE_ROLE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
INTERNAL_SECRET = os.environ.get("INTERNAL_API_SECRET", "")

CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"


def _sb(path: str, method: str = "GET", body=None, params=None):
    url = f"{SUPABASE_URL}/rest/v1{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {
        "apikey": SERVICE_ROLE,
        "Authorization": f"Bearer {SERVICE_ROLE}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, method=method, headers=headers, data=data)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _sb_rpc(name: str, body):
    """Call a Supabase RPC (Postgres function). Returns the response JSON.
    Used for the parcel-snap RPC because PostgREST can't compose
    spatial functions from query params alone."""
    url = f"{SUPABASE_URL}/rest/v1/rpc/{name}"
    headers = {
        "apikey": SERVICE_ROLE,
        "Authorization": f"Bearer {SERVICE_ROLE}",
        "Content-Type": "application/json",
    }
    req = urllib.request.Request(
        url, method="POST", headers=headers,
        data=json.dumps(body).encode("utf-8"),
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def parcel_snap(project_id: str, lat: float, lon: float, radius_m: float = 50.0):
    """Snap a geocoded coordinate to the nearest parcel centroid within
    radius_m. Returns {parcel_id, centroid_lat, centroid_lon, distance_m}
    or None when no parcel is in range (or no parcels uploaded yet).

    Mirrors Keystone's STRtree-based snap (api/_processing.py:600). The
    50 m default matches Keystone's tuned threshold for suburban-density
    parcels."""
    try:
        result = _sb_rpc("nearest_parcel_within", {
            "p_project_id": project_id,
            "p_lat": lat,
            "p_lon": lon,
            "p_radius_m": radius_m,
        })
    except Exception:
        return None
    if not result:
        return None
    row = result[0] if isinstance(result, list) else result
    if not row or row.get("parcel_id") is None:
        return None
    return row


def census_geocode(address: str, suffix: str = ""):
    # Build the full one-line address the Census geocoder needs.
    # Most field-collected CSVs only have the street (e.g. "6116 Harvard Avenue")
    # which Census cannot resolve uniquely. The project-level suffix
    # (e.g. "Keystone Heights, FL 32656") disambiguates it.
    base = (address or "").strip()
    if not base:
        return None
    suf = (suffix or "").strip().lstrip(",").strip()
    full = f"{base}, {suf}" if suf else base
    params = {
        "address": full,
        "benchmark": "Public_AR_Current",
        "format": "json",
    }
    url = CENSUS_URL + "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            data = json.loads(r.read().decode("utf-8"))
    except Exception:
        return None
    matches = (data.get("result") or {}).get("addressMatches") or []
    if not matches:
        return None
    m = matches[0]
    c = m.get("coordinates") or {}
    return {
        "lat": c.get("y"),
        "lon": c.get("x"),
        "matched_address": m.get("matchedAddress"),
    }


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _write_progress(import_id: str, step: str, done: int, total: int):
    """Best-effort progress write — never raises. The wizard polls
    survey_imports rows to render a real progress bar instead of an
    opaque spinner."""
    if not import_id:
        return
    try:
        _sb(
            "/survey_imports",
            method="PATCH",
            params={"id": f"eq.{import_id}"},
            body={
                "processing_step": step,
                "processing_done": done,
                "processing_total": total,
                "processing_at": "now()",
            },
        )
    except Exception:
        # Progress is advisory; a failed write must not break the run.
        pass


def _geocode_points(project_id: str, suffix: str, import_id: str):
    """Phase 4: geocode CSV-imported points the same way we geocode survey
    responses — Census one-line + 50 m parcel snap. Mobile-collected points
    already have GPS coords and aren't touched."""
    to_geo = _sb(
        "/points",
        params={
            "project_id": f"eq.{project_id}",
            "source": "eq.csv_import",
            "lat": "is.null",
            "select": "id,address",
        },
    )
    total = len(to_geo)
    _write_progress(import_id, "geocoding", 0, total)
    geocoded = 0
    snapped = 0
    for idx, p in enumerate(to_geo):
        addr = p.get("address")
        if addr:
            g = census_geocode(addr, suffix)
            if g and g.get("lat") is not None:
                lat, lon = g["lat"], g["lon"]
                source = "census"
                parcel_id = None
                snap = parcel_snap(project_id, lat, lon, 50.0)
                if snap:
                    lat = snap.get("centroid_lat", lat)
                    lon = snap.get("centroid_lon", lon)
                    parcel_id = snap.get("parcel_id")
                    source = "census+parcel"
                    snapped += 1
                _sb(
                    "/points",
                    method="PATCH",
                    params={"id": f"eq.{p['id']}"},
                    body={
                        "lat": lat,
                        "lon": lon,
                        "geocoded_at": "now()",
                        "geocode_source": source,
                        "address": g.get("matched_address") or addr,
                        "parcel_id": parcel_id,
                    },
                )
                geocoded += 1
        if total > 0 and ((idx + 1) % 10 == 0 or idx + 1 == total):
            _write_progress(import_id, "geocoding", idx + 1, total)
    return geocoded, snapped


def run_match(project_id: str, address_suffix_override: str = "", import_id: str = "", kind: str = "survey_responses"):
    # Project settings → radius + address suffix
    settings = _sb(
        "/project_settings",
        params={"project_id": f"eq.{project_id}", "select": "match_radius_m,response_address_column,geocode_address_suffix"},
    )
    s0 = settings[0] if settings else {}
    radius_m = s0.get("match_radius_m") or 30
    suffix = (address_suffix_override or "").strip() or (s0.get("geocode_address_suffix") or "").strip()

    # Phase 4: when this run was triggered by a field-canvass CSV import,
    # geocode the new CSV-imported points before the response/point matcher
    # runs so the new points have coords to match against.
    points_geocoded = 0
    points_snapped = 0
    if kind == "field_canvass":
        points_geocoded, points_snapped = _geocode_points(project_id, suffix, import_id)

    # 1. Geocode responses missing coords
    to_geo = _sb(
        "/survey_responses",
        params={
            "project_id": f"eq.{project_id}",
            "geocoded_lat": "is.null",
            "select": "id,address_used,raw_data",
        },
    )
    total_geo = len(to_geo)
    _write_progress(import_id, "geocoding", 0, total_geo)
    geocoded = 0
    snapped = 0
    for idx, r in enumerate(to_geo):
        addr = r.get("address_used")
        if addr:
            g = census_geocode(addr, suffix)
            if g and g.get("lat") is not None:
                # Phase 2: snap to nearest parcel centroid within 50 m so the
                # marker lands on the house lot, not the road centerline.
                lat, lon = g["lat"], g["lon"]
                source = "census"
                parcel_id = None
                snap = parcel_snap(project_id, lat, lon, 50.0)
                if snap:
                    lat = snap.get("centroid_lat", lat)
                    lon = snap.get("centroid_lon", lon)
                    parcel_id = snap.get("parcel_id")
                    source = "census+parcel"
                    snapped += 1
                _sb(
                    "/survey_responses",
                    method="PATCH",
                    params={"id": f"eq.{r['id']}"},
                    body={
                        "geocoded_lat": lat,
                        "geocoded_lon": lon,
                        "geocode_source": source,
                        "address_used": g.get("matched_address") or addr,
                        "parcel_id": parcel_id,
                    },
                )
                geocoded += 1
        # Write progress every 10 rows (and on the final row) so the wizard
        # can poll for a smooth bar without flooding Supabase.
        if total_geo > 0 and ((idx + 1) % 10 == 0 or idx + 1 == total_geo):
            _write_progress(import_id, "geocoding", idx + 1, total_geo)

    # 2. Match unmatched responses to points within radius
    _write_progress(import_id, "matching", 0, 0)
    unmatched = _sb(
        "/survey_responses",
        params={
            "project_id": f"eq.{project_id}",
            "point_id": "is.null",
            "geocoded_lat": "not.is.null",
            "select": "id,geocoded_lat,geocoded_lon",
        },
    )
    # Fetch ALL points for the project (small projects only; paginate for big ones)
    points = _sb(
        "/points",
        params={
            "project_id": f"eq.{project_id}",
            "matched_response_id": "is.null",
            "select": "id,lat,lon",
            "limit": "10000",
        },
    )

    total_match = len(unmatched)
    _write_progress(import_id, "matching", 0, total_match)
    matched_now = 0
    for idx, r in enumerate(unmatched):
        best_id, best_d = None, None
        rlat, rlon = r["geocoded_lat"], r["geocoded_lon"]
        for p in points:
            d = haversine_m(rlat, rlon, p["lat"], p["lon"])
            if d <= radius_m and (best_d is None or d < best_d):
                best_id, best_d = p["id"], d
        if best_id:
            _sb(
                "/survey_responses",
                method="PATCH",
                params={"id": f"eq.{r['id']}"},
                body={"point_id": best_id, "match_distance_m": best_d, "matched_at": "now()"},
            )
            _sb(
                "/points",
                method="PATCH",
                params={"id": f"eq.{best_id}"},
                body={"matched_response_id": r["id"]},
            )
            matched_now += 1
            # take that point out of the candidate pool
            points = [p for p in points if p["id"] != best_id]
        if total_match > 0 and ((idx + 1) % 10 == 0 or idx + 1 == total_match):
            _write_progress(import_id, "matching", idx + 1, total_match)

    # 3. Re-pull counts from the view for the summary
    counts = _sb(
        "/v_match_status_counts",
        params={"project_id": f"eq.{project_id}", "select": "m1_count,f1_count,r1_count"},
    )
    summary = counts[0] if counts else {"m1_count": 0, "f1_count": 0, "r1_count": 0}
    return {
        "geocoded": geocoded + points_geocoded,
        "snapped_to_parcel": snapped + points_snapped,
        "matched_now": matched_now,
        # Per-stream counts for the wizard's done state.
        "responses_geocoded": geocoded,
        "responses_snapped": snapped,
        "points_geocoded": points_geocoded,
        "points_snapped": points_snapped,
        **summary,
    }


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            # Auth: shared secret in X-Internal-Secret header. The Next.js
            # auth shim at /api/match sets this; direct calls without the
            # header are rejected to prevent service-role abuse.
            supplied = self.headers.get("X-Internal-Secret", "")
            if not INTERNAL_SECRET or supplied != INTERNAL_SECRET:
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b'{"error":"unauthorized"}')
                return
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            project_id = (q.get("project_id") or [""])[0]
            suffix_override = (q.get("address_suffix") or [""])[0]
            import_id = (q.get("import_id") or [""])[0]
            kind = (q.get("kind") or ["survey_responses"])[0]
            if not project_id:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'{"error":"project_id required"}')
                return
            result = run_match(project_id, suffix_override, import_id, kind)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode("utf-8"))
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
