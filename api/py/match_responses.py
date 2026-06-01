"""
FieldSurvey response matcher — Python serverless function.

Phase 3 — Keystone 3-tier matcher.

The original implementation linked responses to points with a single
haversine pass within 30 m. Real Keystone data showed that broke down in
two common cases: (a) the same address geocoded slightly differently
between the canvass log and the response, putting them 35-40 m apart;
(b) Census returned the road centerline for one side and a snapped
parcel centroid for the other, drifting them >30 m even though they
were the same house. The 3-tier matcher mirrors
KeyStone_project/api/_processing.py:_match_iaq_to_contacts (line 1025).

  Tier 1 — exact normalized address ⇄ exact normalized address.
  Tier 2 — same house number + difflib street similarity ≥ 0.70.
  Tier 3 — same parcel_id (both sides snapped to the same parcel).
  Tier 4 — haversine ≤ project_settings.match_radius_m fallback.

Bipartite: each point matches at most one response. Responses pass
through tiers in order; later tiers only see what earlier tiers couldn't
match. Per-tier counts surface in the wizard's done state.

Invoked via POST /api/py/match_responses?project_id=...
  &address_suffix=...  (optional, overrides project_settings)
  &import_id=...       (optional, enables progress writes)
  &kind=...            ('survey_responses' default, or 'field_canvass'
                       to ALSO geocode points written by /api/points/import)

Auth: SUPABASE_SERVICE_ROLE_KEY in env. Caller MUST present the matching
X-Internal-Secret header — the /api/match and /api/responses/import
shims set this; direct calls without the header are rejected.

match_status is NEVER stored. It is derived by v_match_status (migration
002) on every read. Re-running this matcher is idempotent — every step
filters on null/unmatched rows.
"""
from http.server import BaseHTTPRequestHandler
import json
import math
import os
import re
import urllib.parse
import urllib.request
from difflib import SequenceMatcher


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


# Phase 3 — Keystone address parser/normalizer.
# Mirrors KeyStone_project/api/_processing.py _parse_addr_parts and the
# normalization passes used inside _match_iaq_to_contacts.

_STREET_SUFFIXES = {
    "st", "street", "ave", "avenue", "rd", "road", "dr", "drive", "ln",
    "lane", "blvd", "boulevard", "hwy", "highway", "ct", "court", "pl",
    "place", "ter", "terrace", "way", "trl", "trail", "pkwy", "parkway",
    "cir", "circle", "sq", "square", "pt", "point", "loop",
    # Cardinal directions live in street_core and don't help dedup
    "n", "s", "e", "w", "ne", "nw", "se", "sw", "north", "south", "east", "west",
}

_PUNCT_RE = re.compile(r"[.,;:'\"()\[\]/]")
_UNIT_RE = re.compile(r"\b(apt|apartment|unit|suite|ste|#|lot)\s*\S+\b")
_WS_RE = re.compile(r"\s+")
_HOUSE_NUM_RE = re.compile(r"^\s*(\d+\S*)\s+(.+)$")


def _normalize_address(addr: str) -> str:
    """Lowercase, strip punctuation/unit suffix/street suffix, collapse
    whitespace. Two addresses that resolve to the same physical lot
    should produce identical strings out of this function."""
    if not addr:
        return ""
    s = addr.strip().lower()
    s = _PUNCT_RE.sub(" ", s)
    s = _UNIT_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).strip()
    parts = [p for p in s.split(" ") if p and p not in _STREET_SUFFIXES]
    return " ".join(parts)


def _parse_addr_parts(addr: str):
    """Return (house_num, street_core). house_num is "" if not found.
    street_core is the normalized form (suitable for fuzzy comparison)."""
    if not addr:
        return ("", "")
    m = _HOUSE_NUM_RE.match(addr.strip())
    if not m:
        return ("", _normalize_address(addr))
    house = m.group(1)
    street_core = _normalize_address(m.group(2))
    return (house, street_core)


def _fuzzy_ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio() if a and b else 0.0


def _link_response_to_point(response_id: str, point_id: str, distance_m):
    body = {"point_id": point_id, "matched_at": "now()"}
    if distance_m is not None:
        body["match_distance_m"] = distance_m
    _sb("/survey_responses", method="PATCH",
        params={"id": f"eq.{response_id}"}, body=body)
    _sb("/points", method="PATCH",
        params={"id": f"eq.{point_id}"},
        body={"matched_response_id": response_id})


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

    # Phase 3 — 3-tier bipartite matcher.
    _write_progress(import_id, "matching", 0, 0)
    unmatched = _sb(
        "/survey_responses",
        params={
            "project_id": f"eq.{project_id}",
            "point_id": "is.null",
            "geocoded_lat": "not.is.null",
            "select": "id,geocoded_lat,geocoded_lon,address_used,parcel_id",
        },
    )
    points = _sb(
        "/points",
        params={
            "project_id": f"eq.{project_id}",
            "matched_response_id": "is.null",
            "lat": "not.is.null",
            "select": "id,lat,lon,address,parcel_id",
            "limit": "10000",
        },
    )

    total_match = len(unmatched)
    _write_progress(import_id, "matching", 0, total_match)
    used = set()  # point ids already consumed (bipartite invariant)
    matched_by_tier = {1: 0, 2: 0, 3: 0, 4: 0}
    progress_done = 0

    def _commit(response, point, tier):
        d = None
        if point.get("lat") is not None and point.get("lon") is not None:
            d = haversine_m(
                response["geocoded_lat"], response["geocoded_lon"],
                point["lat"], point["lon"],
            )
        _link_response_to_point(response["id"], point["id"], d)
        used.add(point["id"])
        matched_by_tier[tier] += 1

    # ── Tier 1 — exact normalized address ────────────────────────────────
    addr_to_points = {}
    for p in points:
        key = _normalize_address(p.get("address") or "")
        if key:
            addr_to_points.setdefault(key, []).append(p)
    remaining = []
    for r in unmatched:
        key = _normalize_address(r.get("address_used") or "")
        chosen = None
        if key:
            for p in addr_to_points.get(key, []):
                if p["id"] not in used:
                    chosen = p
                    break
        if chosen:
            _commit(r, chosen, 1)
        else:
            remaining.append(r)
        progress_done += 1
        if total_match > 0 and (progress_done % 10 == 0 or progress_done == total_match):
            _write_progress(import_id, "matching", progress_done, total_match * 4)

    # ── Tier 2 — same house number + fuzzy street ≥ 0.70 ─────────────────
    house_to_points = {}
    for p in points:
        if p["id"] in used:
            continue
        h, street = _parse_addr_parts(p.get("address") or "")
        if h:
            house_to_points.setdefault(h, []).append((p, street))
    tier2_remaining = []
    for r in remaining:
        h, street_r = _parse_addr_parts(r.get("address_used") or "")
        chosen = None
        chosen_score = 0.0
        if h:
            for (p, street_p) in house_to_points.get(h, []):
                if p["id"] in used:
                    continue
                score = _fuzzy_ratio(street_r, street_p)
                if score >= 0.70 and score > chosen_score:
                    chosen = p
                    chosen_score = score
        if chosen:
            _commit(r, chosen, 2)
        else:
            tier2_remaining.append(r)
        progress_done += 1
        if total_match > 0 and (progress_done % 10 == 0 or progress_done == total_match * 2):
            _write_progress(import_id, "matching", progress_done, total_match * 4)

    # ── Tier 3 — same parcel_id (both sides snapped to the same parcel) ──
    parcel_to_points = {}
    for p in points:
        if p["id"] in used:
            continue
        if p.get("parcel_id"):
            parcel_to_points.setdefault(p["parcel_id"], []).append(p)
    tier3_remaining = []
    for r in tier2_remaining:
        chosen = None
        rpid = r.get("parcel_id")
        if rpid:
            for p in parcel_to_points.get(rpid, []):
                if p["id"] not in used:
                    chosen = p
                    break
        if chosen:
            _commit(r, chosen, 3)
        else:
            tier3_remaining.append(r)
        progress_done += 1
        if total_match > 0 and (progress_done % 10 == 0 or progress_done == total_match * 3):
            _write_progress(import_id, "matching", progress_done, total_match * 4)

    # ── Tier 4 — haversine ≤ project radius fallback ─────────────────────
    for r in tier3_remaining:
        rlat, rlon = r["geocoded_lat"], r["geocoded_lon"]
        best, best_d = None, None
        for p in points:
            if p["id"] in used:
                continue
            if p.get("lat") is None or p.get("lon") is None:
                continue
            d = haversine_m(rlat, rlon, p["lat"], p["lon"])
            if d <= radius_m and (best_d is None or d < best_d):
                best, best_d = p, d
        if best:
            _commit(r, best, 4)
        progress_done += 1
        if total_match > 0 and (progress_done % 10 == 0 or progress_done == total_match * 4):
            _write_progress(import_id, "matching", progress_done, total_match * 4)

    matched_now = sum(matched_by_tier.values())

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
        # Phase 3 per-tier match counts.
        "matched_tier1_exact": matched_by_tier[1],
        "matched_tier2_fuzzy": matched_by_tier[2],
        "matched_tier3_parcel": matched_by_tier[3],
        "matched_tier4_proximity": matched_by_tier[4],
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
