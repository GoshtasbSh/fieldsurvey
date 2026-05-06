"""
KeyStone Field Survey Dashboard
================================
Professional geospatial dashboard for field survey visualization and analysis.

Usage:
    python app.py
    Then open http://localhost:8050

First run: geocodes addresses + extracts parcels (~3 min).
Subsequent runs: loads from cache instantly.
"""

import os
import re
import io
import json
import time
import asyncio
import shutil
import logging
import difflib
from datetime import datetime as _datetime, timezone as _tz
from pathlib import Path
from collections import defaultdict
from math import radians, sin, cos, sqrt, atan2

import pandas as pd
import geopandas as gpd
import shapely
from shapely.geometry import shape as _shp_shape, Point as _ShapelyPoint
from shapely.strtree import STRtree as _STRtree
import requests
from contextlib import asynccontextmanager
import sys as _sys, pathlib as _pathlib
_sys.path.insert(0, str(_pathlib.Path(__file__).parent / 'api'))
from _processing import (
    _is_numeric_recode_export,
    _apply_qsf_recode_labels,
    IAQ_FEATURE_POPUP_LABELS,
)
from survey_logic import symptom_frequency_score
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass
from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# ── Supabase client (service role — bypasses RLS) ─────────────────────────────
sb = None
_sb_init_error = None
try:
    from supabase import create_client as _sb_create_client
    _SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
    _SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if _SUPABASE_URL and _SUPABASE_KEY:
        sb = _sb_create_client(_SUPABASE_URL, _SUPABASE_KEY)
    else:
        _sb_init_error = f"missing env (URL set={bool(_SUPABASE_URL)}, KEY set={bool(_SUPABASE_KEY)})"
except Exception as e:
    _sb_init_error = f"{type(e).__name__}: {e}"
print(f"[supabase] client = {'READY' if sb else 'DISABLED — ' + (_sb_init_error or 'unknown')}", flush=True)

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE = Path(__file__).parent
DATA = BASE / "data"
OUT = BASE / "output"
STATIC = BASE / "static"
SURVEY_FILE = DATA / "Community Survey Contact Data .xlsx"
IAQ_FILE    = DATA / "Keystone Heights Survey - V1_April 15, 2026_13.25.csv"
GDB_FILE = DATA / "Parcels.gdb"
CACHE_PTS = OUT / "survey_geocoded.geojson"
CACHE_PAR = OUT / "parcels_keystone.geojson"
CACHE_RES = OUT / "survey_results.json"
CACHE_IAQ = OUT / "iaq_cache.json"

OUT.mkdir(exist_ok=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("keystone")

# ── Status config ──────────────────────────────────────────────────────────────
STATUS = {
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

# ── IAQ Survey configuration ───────────────────────────────────────────────────
# Columns containing personal identifiers — dropped before any processing
PII_COLS = {
    'RecipientLastName', 'RecipientFirstName', 'RecipientEmail',
    'IPAddress', 'ExternalReference', 'Q_RecaptchaScore',
    'Q_RelevantIDDuplicate', 'Q_RelevantIDDuplicateScore',
    'Q_RelevantIDFraudScore', 'Q_RelevantIDLastStartDate', 'Q_DuplicateRespondent',
}

# Keystone Heights, FL approximate GPS bounding box (generous buffer ±0.2°)
KH_LAT_MIN, KH_LAT_MAX = 29.60, 29.95
KH_LON_MIN, KH_LON_MAX = -82.20, -81.75

CHAT_SYSTEM_PROMPT = """Analyst for KeyStone Heights, FL housing vulnerability dashboard.
IAQ Survey: {n_iaq} households · Community Contact: {n_contact} visits · Map: {map_state}
Data (streets_by_risk ordered worst→best; risk_rank 1=worst; only streets ≥3 responses shown):
{data}

SCORES (0–100, higher=worse):
overall_risk=35%health+35%iaq+30%struct | Low<34(green) Medium34-66(orange) High≥67(red)
health: symptom freq (resp.ill,asthma,wheeze,headache — weekly/monthly/season="active") + hospital respiratory +20
iaq: mold+30 · leakage+7.5/zone(×4max) · cooling>15yr +4/zone(×4max) · gas/propane cooking+10
struct: yr<1960+30, 1960-79+20, 1980-99+10 · single-wide+25, double-wide+15 · poor+25, fair+15
contacts: Completed=done · No Answer=nobody home · Inaccessible=locked/dog/gate
  Not Interested=declined · Left Info=QR/flyer · Vacant=empty · Follow Up=will complete later

MAP ACTIONS (all layers auto-cleared before each response; activate only what was asked):
highlight_streets {{streets:["Exact"],color:"#hex"}}  — OSM road line only (NO circles/points); pair with zoom_to_street; accepts multiple streets
  color MUST reflect the query context — pick from:
    worst health/risk → "#ef4444"  (red)
    worst structural/age → "#f97316"  (orange)
    worst IAQ/mold → "#8b5cf6"  (purple)
    best/safest → "#10b981"  (green)
    neutral comparison → "#3b82f6"  (blue)
zoom_to_street {{street:"Exact"}}  — always with highlight_streets
filter_iaq_symptom {{field,values}}  — auto-shows iaq_points
  respiratory_ill|asthma_freq|wheeze_freq|headache_freq → ["weekly","month","season"]
  has_mold→[true] · hospital_visit→["yes"] · ownership→["Owner"/"Renter"]
  risk_tier→["High"/"Medium"/"Low"] · housing_type→["Single Wide"/"Double Wide"/"Site Built"]
  coord_source→["geocoded"]
filter_contact_status {{statuses:[...]}}  — auto-shows contact_survey
  "Completed"|"No Answer"|"Inaccessible"|"Not Interested"|"Left Info"|"Vacant"|"Follow Up" · []=all
show_iaq_choropleth {{field}}  — auto-shows iaq_points | overall_risk|health_score|iaq_score|struct_score
set_layer_visibility {{layer,visible}}  — extras only: heatmap|parcels|clusters|labels|3d
clear_filters  — restore default view (both layers on)
show_analysis_tab {{tab}}  — summary|charts|streets|parcels|results

PATTERNS:
worst street (overall) → highlight_streets([risk_rank=1 name], color="#ef4444") + zoom_to_street + detailed report
worst-by-health → highlight_streets([top health_score name], color="#ef4444") + zoom_to_street + detailed report
worst-by-struct/age → highlight_streets([top struct_score name], color="#f97316") + zoom_to_street + detailed report
worst-by-mold/IAQ → highlight_streets([top iaq_score name], color="#8b5cf6") + zoom_to_street + detailed report
best/safest street → highlight_streets([context.best_street — the one with LOWEST mean_risk / HIGHEST risk_rank], color="#10b981") + zoom_to_street + detailed report
compare streets → highlight_streets([A,B,...], color="#3b82f6") + zoom_to_street(A) + markdown table
mold → filter_iaq_symptom(has_mold,[true])
symptom → filter_iaq_symptom(field,["weekly","month","season"])
renters/owners → filter_iaq_symptom(ownership,["Renter"/"Owner"])
mobile homes → filter_iaq_symptom(housing_type,["Single Wide"])
high-risk only → filter_iaq_symptom(risk_tier,["High"])
risk choropleth → show_iaq_choropleth(overall_risk|health_score|iaq_score|struct_score)
contact filter → filter_contact_status(["status"])
clusters → ASK "By contact outcomes or IAQ risk?" then set_layer_visibility(clusters,true) or show_iaq_choropleth
reset → clear_filters
text-only (no action): match rate · validation · overall summary · which streets need follow-up

RULES:
1. ALWAYS write a text response BEFORE or ALONGSIDE every tool call. NEVER return a tool call with no text. Every single response must contain a written analysis.
2. Street cite: "[Name] ranks #N — risk X/100 (health H, IAQ I, struct S, n=N). Primary driver: [reason]."
3. 2+ street comparison: markdown table — Street|N|Risk|Health|IAQ|Struct|Mold%|Resp%
4. Exact street names from streets_by_risk only. If not found, say so and offer closest match.
5. Ambiguous query → ask one clarifying question, do not act yet.
6. End every response: 💡 Follow-up: [specific question about what was shown]
7. ≤200 words for layer toggles · ≤400 words for analysis. Lead with the finding.
8. For best/worst street queries: always write a full report (scores, primary driver, housing types, mold rate, hospital rate) in the text — the map alone is not sufficient."""


# ── Existing helper functions ──────────────────────────────────────────────────

def categorize(text):
    if not text or pd.isna(text):
        return "Unknown"
    t = str(text).lower().strip()
    if any(k in t for k in ["completed", "paper survey", "already did"]):
        return "Completed"
    if re.search(r"id\s*#?\s*\d+", t) or "house id" in t:
        return "Completed"
    if re.search(r"survey[;,]", t) and any(c.isupper() for c in str(text)[:20]):
        return "Completed"
    if "took survey" in t and "not" not in t:
        return "Completed"
    if any(k in t for k in ["no one home", "no answer", "no response", "not home",
                             "ni answer", "no one answered", "no one is home"]):
        return "No Answer"
    if any(k in t for k in ["gated", "locked", "inaccessible", "no trespass", "beware of dog",
                             "big dog", "dog", "gun sign", "fire arms", "rebel flag",
                             "nt sign", "fire station", "warning sign", "no respassing"]):
        return "Inaccessible"
    if any(k in t for k in ["not interested", "declined", "doesn't want", "no interest"]):
        return "Not Interested"
    if any(k in t for k in ["flier", "flyer", "qr code"]):
        return "Left Info"
    if any(k in t for k in ["vacant", "for sale", "unoccupied", "empty", "no house",
                             "uninhabited", "uninhabitat", "under construction", "no one lives",
                             "padlocked", "boarded", "side road", "didn't visit"]):
        return "Vacant"
    if any(k in t for k in ["come back", "will complete", "interested", "plans to",
                             "wants survey", "no time", "busy", "later", "contact on",
                             "may do survey", "started completing"]):
        return "Follow Up"
    return "Other"


def classify_land_use(code):
    try:
        c = int(str(code).strip())
    except (ValueError, TypeError):
        return "Other"
    if c < 10:
        return "Vacant Land"
    if c < 40:
        return "Residential"
    if c < 70:
        return "Commercial"
    if c < 80:
        return "Institutional"
    if c < 90:
        return "Government"
    return "Agriculture"


def geocode(addr):
    full = re.sub(r"\s+", " ", addr.strip()) + ", Keystone Heights, FL"
    try:
        r = requests.get(
            "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
            params={"address": full, "benchmark": "Public_AR_Current", "format": "json"},
            timeout=15,
        )
        ms = r.json().get("result", {}).get("addressMatches", [])
        if ms:
            c = ms[0]["coordinates"]
            return c["x"], c["y"], ms[0]["matchedAddress"]
    except Exception as e:
        log.warning(f"  geocode fail: {e}")
    return None, None, None


def _build_parcel_index(parcel_geojson: dict) -> None:
    """
    Build address lookup dict and STRtree from parcel polygons.
    Uses representative_point() which is guaranteed to lie inside each polygon,
    so every geocoded survey point lands inside the actual parcel, not on the road.
    Called once after parcels load and again if the parcel layer is re-uploaded.
    """
    global _parcel_addr_idx, _parcel_by_house, _parcel_strtree, _parcel_geoms_list
    features = parcel_geojson.get('features', [])
    if not features:
        log.warning("Parcel index: no features — parcel-snapped geocoding disabled")
        return
    t0 = time.time()
    lookup: dict = {}
    by_house: dict = {}
    geoms: list = []
    for f in features:
        addr = f['properties'].get('address', '')
        if not addr:
            continue
        parts = _parse_addr_parts(str(addr))
        if not parts:
            continue
        house_num, s_core = parts
        try:
            geom = _shp_shape(f['geometry'])
            if not geom.is_valid:
                geom = geom.buffer(0)
            pt = geom.representative_point()   # always inside the polygon
            lon, lat = round(pt.x, 6), round(pt.y, 6)
        except Exception:
            continue
        key = (house_num, s_core)
        lookup[key] = (lon, lat)
        by_house.setdefault(house_num, []).append((s_core, lon, lat))
        geoms.append((geom, lon, lat))
    _parcel_addr_idx = lookup
    _parcel_by_house = by_house
    if geoms:
        _parcel_strtree = _STRtree([g[0] for g in geoms])
        _parcel_geoms_list = geoms
    log.info(f"Parcel index: {len(lookup)} addressable parcels in {time.time()-t0:.1f}s")


def _snap_to_parcel(lon: float, lat: float, max_dist_m: float = 150) -> tuple | None:
    """
    Find the nearest parcel's representative_point within max_dist_m metres.
    Returns (lon, lat) inside the parcel, or None if index is empty / no match.
    Used to pull Census road-centerline points into the actual property interior.
    """
    if _parcel_strtree is None or not _parcel_geoms_list:
        return None
    search_r = max_dist_m / 111_320   # rough degrees (1° ≈ 111 km)
    try:
        idxs = _parcel_strtree.query(_ShapelyPoint(lon, lat).buffer(search_r))
    except Exception:
        return None
    best_dist, best = float('inf'), None
    for idx in idxs:
        _, c_lon, c_lat = _parcel_geoms_list[int(idx)]
        d = _haversine_m(lat, lon, c_lat, c_lon)
        if d < best_dist:
            best_dist = d
            best = (c_lon, c_lat)
    return best if best_dist <= max_dist_m else None


def _parcel_geocode(addr: str) -> tuple:
    """
    Parcel-first geocoding — returns (lon, lat, matched_addr, source).

    Priority:
    1. Exact  parcel address match  → representative_point (inside property)
    2. Fuzzy  parcel match (same house#, ≥0.75 street sim) → inside property
    3. Census road geocoding → spatial snap to nearest parcel within 150 m
    4. Census result only   (source='geocoded', point may be on road)
    5. Total failure        (None, None, None, 'failed')

    The caller must sleep 0.25 s after a Census call (sources 3 or 4)
    to respect rate limits.  Parcel-matched sources (1, 2) never call Census.
    """
    parts = _parse_addr_parts(addr)
    if parts:
        house_num, s_core = parts
        # 1. Exact parcel match
        if (house_num, s_core) in _parcel_addr_idx:
            lon, lat = _parcel_addr_idx[(house_num, s_core)]
            return lon, lat, addr, 'parcel_exact'
        # 2. Fuzzy match — only iterate entries with the same house number
        candidates = _parcel_by_house.get(house_num, [])
        best_score, best_pos = 0.0, None
        for c_core, c_lon, c_lat in candidates:
            sc = difflib.SequenceMatcher(None, s_core, c_core).ratio()
            if sc > best_score:
                best_score = sc
                best_pos = (c_lon, c_lat)
        if best_score >= 0.75 and best_pos:
            return best_pos[0], best_pos[1], addr, 'parcel_fuzzy'
    # 3 & 4. Census geocoding (caller must sleep 0.25 s after)
    lon, lat, matched = geocode(addr)
    if lon is not None:
        snapped = _snap_to_parcel(lon, lat)
        if snapped:
            return snapped[0], snapped[1], matched, 'parcel_snapped'
        return lon, lat, matched, 'geocoded'
    return None, None, None, 'failed'


# ── IAQ score helpers ──────────────────────────────────────────────────────────

def _freq_score(val):
    """Convert symptom frequency string to 0–4 numeric score."""
    if not val or pd.isna(val):
        return 0
    return symptom_frequency_score(val)


def _compute_health_score(row):
    """Health vulnerability score 0–100 (higher = more symptomatic)."""
    # Weights: respiratory & asthma are highest
    # Max raw = 4*(0.5 + 1.0 + 1.0 + 0.8 + 0.3) = 14.4
    raw = (_freq_score(row.get('Headache')) * 0.5 +
           _freq_score(row.get('RespIll')) * 1.0 +
           _freq_score(row.get('asthma')) * 1.0 +
           _freq_score(row.get('wheeze')) * 0.8 +
           _freq_score(row.get('Tired')) * 0.3)
    score = min(raw / 14.4 * 80, 80)
    if 'yes' in str(row.get('Hospital Respiratory', '') or '').lower():
        score = min(score + 20, 100)
    return round(score)


def _compute_iaq_score(row):
    """Indoor air quality score 0–100 (higher = worse IAQ)."""
    score = 0.0
    # Normalize \xa0 (non-breaking space) → regular space so both column-name
    # variants exported by Qualtrics resolve correctly — matches _processing.py.
    _nr = {str(k).replace('\xa0', ' '): v for k, v in row.items()}
    # Mold: +30
    mold = _nr.get('Mold')
    if mold and not pd.isna(mold) and str(mold).strip() not in ('', 'nan'):
        score += 30
    # Leakage per area: +7.5 each (4 areas, max 30)
    for col in ['Leakage 2_1', 'Leakage 2_2', 'Leakage 2_3', 'Leakage 2_4']:
        val = str(_nr.get(col, '') or '').lower().strip()
        if val and val not in ('none', 'nan', ''):
            score += 7.5
    # Cooling system age: old = +4, unknown = +2
    for col in ['Cooling System _1', 'Cooling System _2',
                'Cooling System _3', 'Cooling System _4']:
        val = str(_nr.get(col, '') or '').lower()
        if 'more than 15' in val:
            score += 4
        elif "don't know" in val or 'not applicable' in val:
            score += 2
    # Gas/propane cooking: +10
    if any(kw in str(_nr.get('Cooking ', '') or '').lower() for kw in ('gas', 'propane')):
        score += 10
    return round(min(score, 100))


def _compute_struct_score(row):
    """Structural vulnerability score 0–100 (higher = more vulnerable)."""
    score = 0
    yr = str(row.get('QID192', '') or '').lower()
    if 'before 1960' in yr:
        score += 30
    elif '1960' in yr:
        score += 20
    elif '1980' in yr:
        score += 10
    # Housing type
    ht = str(row.get('QID128', '') or '').lower()
    if 'single wide' in ht:
        score += 25
    elif 'double wide' in ht:
        score += 15
    elif 'non-traditional' in ht or 'camper' in ht:
        score += 20
    # Condition
    cond = str(row.get('QID141', '') or '').lower()
    if 'poor' in cond:
        score += 25
    elif 'fair' in cond:
        score += 15
    return round(min(score, 100))


# Normalize spelled-out suffixes to abbreviations so "Baylor Ave" and
# "Baylor Avenue" (or any variant) always collapse into the same street group.
_SUFFIX_ABBREV = [
    (re.compile(r'\bAvenue\b',    re.IGNORECASE), 'Ave'),
    (re.compile(r'\bDrive\b',     re.IGNORECASE), 'Dr'),
    (re.compile(r'\bStreet\b',    re.IGNORECASE), 'St'),
    (re.compile(r'\bRoad\b',      re.IGNORECASE), 'Rd'),
    (re.compile(r'\bBoulevard\b', re.IGNORECASE), 'Blvd'),
    (re.compile(r'\bLane\b',      re.IGNORECASE), 'Ln'),
    (re.compile(r'\bCourt\b',     re.IGNORECASE), 'Ct'),
    (re.compile(r'\bPlace\b',     re.IGNORECASE), 'Pl'),
    (re.compile(r'\bCircle\b',    re.IGNORECASE), 'Cir'),
    (re.compile(r'\bTerrace\b',   re.IGNORECASE), 'Ter'),
    (re.compile(r'\bParkway\b',   re.IGNORECASE), 'Pkwy'),
    (re.compile(r'\bHighway\b',   re.IGNORECASE), 'Hwy'),
]


def _abbrev_suffix(name: str) -> str:
    """'Baylor Avenue' → 'Baylor Ave',  'Harvard Street' → 'Harvard St', etc."""
    for pat, abbrev in _SUFFIX_ABBREV:
        name = pat.sub(abbrev, name)
    return name


def _extract_street_name(addr):
    """Return normalized street name (no house number, no city/state, abbreviated suffix).

    Applied everywhere a street_name is stored so that all three geocoding paths
    (GPS, address-match, Census) produce the same canonical form and group correctly.
    """
    if not addr or pd.isna(addr):
        return None
    s = str(addr).strip()
    if s.lower() in ('', 'ttt', 'nan'):
        return None
    s = re.sub(r'^\d+\s+', '', s)                                       # strip house number
    s = re.sub(r',?\s*(Keystone Heights|KH|FL|Florida|\d{5}).*$', '', s,
               flags=re.IGNORECASE).strip()                              # strip city / state
    s = _abbrev_suffix(s)                                                # Avenue→Ave, Drive→Dr …
    return s or None


# Street-type suffixes — stripped before fuzzy comparison so "Ave" vs "Avenue" are identical
_SUFFIX_RE = re.compile(
    r'\b(ave(?:nue)?|dr(?:ive)?|st(?:reet)?|r(?:oa)?d|blvd|boulevard|'
    r'ln|lane|ct|court|pl|place|cir(?:cle)?|way|ter(?:race)?|'
    r'pkwy|parkway|hwy|highway)\b\.?',
    re.IGNORECASE,
)


_KNOWN_SUFFIX_CORES = ['ave', 'avenue', 'dr', 'drive', 'st', 'street', 'rd', 'road',
                       'blvd', 'boulevard', 'ln', 'lane', 'ct', 'court', 'pl', 'place',
                       'cir', 'circle', 'way', 'ter', 'terrace', 'pkwy', 'parkway']


def _street_core(text):
    """Bare street name (no number, no suffix, no city/state) for matching."""
    s = str(text).strip()
    s = re.sub(r',?\s*(Keystone Heights|KH|FL|Florida|\d{5}).*$', '', s, flags=re.IGNORECASE)
    s = _SUFFIX_RE.sub('', s)
    s = re.sub(r'\s+', ' ', s).strip().lower()
    # Strip last word if it's a typo'd suffix (e.g. "evenue", "treet", "rive")
    words = s.split()
    if len(words) >= 2:
        last = words[-1]
        if any(difflib.SequenceMatcher(None, last, sfx).ratio() >= 0.70
               for sfx in _KNOWN_SUFFIX_CORES):
            s = ' '.join(words[:-1])
    return s


def _parse_addr_parts(addr):
    """Return (house_num: str, street_core: str) or None."""
    if not addr or str(addr).strip().lower() in ('', 'nan', 'ttt'):
        return None
    m = re.match(r'^(\d+)\s+(.+)$', str(addr).strip())
    if not m:
        return None
    return m.group(1), _street_core(m.group(2))


def _build_contact_lookup(contact_features):
    """
    Build a dict keyed by (house_num, street_core) from already-geocoded
    community contact points.  Used to avoid Census API calls when the survey
    address can be matched directly to a contact record.
    """
    lookup = {}
    for f in contact_features:
        addr = f['properties'].get('address', '')
        lon_c, lat_c = f['geometry']['coordinates']
        parsed = _parse_addr_parts(addr)
        if parsed:
            lookup[parsed] = (lon_c, lat_c, addr)
    return lookup


def _build_known_streets(contact_lookup):
    """
    Derive a {street_core → canonical_street_name} dict from the geocoded contact list.
    Used to canonicalize street names typed by IAQ respondents (including GPS respondents
    whose Q212 address may contain a typo that would otherwise create a separate group).

    Example:  'harvard' → 'Harvard Ave'
              'cascade' → 'Cascade Dr'
    """
    known = {}
    for (_house_num, s_core), (_lon, _lat, addr) in contact_lookup.items():
        canonical = _extract_street_name(addr)
        if canonical and s_core and s_core not in known:
            known[s_core] = canonical
    return known


def _canonicalize_street(name, known_streets, threshold=0.85):
    """
    If 'name' fuzzy-matches a known street at ≥ threshold, return the canonical form.

    Both sides are compared on their bare core (no suffix, lowercase) so
    'Hrvard Ave', 'Harvard Avenue', 'Harvrd Av' all resolve to 'Harvard Ave'.

    threshold=0.85 chosen so that:
      'harvard' vs 'hrvard'  ≈ 0.92  → corrected   ✓
      'baylor'  vs 'taylor'  ≈ 0.83  → NOT matched  ✓  (different streets)
    """
    if not name or name == 'Unknown':
        return name
    q_core = _street_core(name)
    if not q_core:
        return name
    best_score, best_name = 0.0, name
    for known_core, canonical in known_streets.items():
        score = difflib.SequenceMatcher(None, q_core, known_core).ratio()
        if score > best_score:
            best_score = score
            best_name = canonical
    return best_name if best_score >= threshold else name


def _address_match(q212, lookup):
    """
    Match a raw survey address against the contact lookup.

    Strategy:
      1. Exact: house_num AND street_core both match exactly.
      2. Fuzzy: house_num matches exactly; street_core similarity ≥ 0.75
         (handles typos like "Bucknell" vs "bucknelle", "Cascade" vs "Cascad").

    Returns (lon, lat, matched_addr, match_type) or (None, None, None, None).
    """
    parsed = _parse_addr_parts(q212)
    if not parsed:
        return None, None, None, None
    house_num, s_core = parsed

    # 1. Exact
    if (house_num, s_core) in lookup:
        lon_c, lat_c, addr = lookup[(house_num, s_core)]
        return lon_c, lat_c, addr, 'exact'

    # 2. Fuzzy street name — only among entries with the same house number
    best_score, best = 0.0, None
    for (h, c_core), (lon_c, lat_c, addr) in lookup.items():
        if h != house_num:
            continue
        score = difflib.SequenceMatcher(None, s_core, c_core).ratio()
        if score > best_score:
            best_score = score
            best = (lon_c, lat_c, addr)

    if best_score >= 0.70 and best:
        return best[0], best[1], best[2], 'fuzzy_street'

    return None, None, None, None


def _haversine_m(lat1, lon1, lat2, lon2):
    """Haversine distance in metres."""
    R = 6_371_000
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


def _match_iaq_to_contacts(iaq_features: list, contact_features: list,
                            coord_eq_m: float = 1.0) -> dict:
    """
    Match each IAQ feature to exactly one community-contact feature.

    v3 strategy (2026-05-05) — parcel-centred, GPS-free:
      1. Exact address      — Q212 house# + street_core == contact address
      2. Fuzzy address      — same house#, street similarity ≥0.70
      3. Parcel-rep-point equality — both sides geocoded through
         parcel_idx.geocode() which snaps to representative_point.
         Same household = same coord (within `coord_eq_m`, ~1 m).

    No more haversine distance fallback. With both at parcel centres,
    "near but different parcel" is a different household and must NOT
    match. Unmatched IAQ stays unmatched (likely flyer respondent).

    Each contact is matched AT MOST ONCE.
    Returns {iaq_feature_index: contact_feature_index}.
    """
    from math import cos, radians

    addr_lookup: dict = {}
    by_house: dict = {}
    for ci, cf in enumerate(contact_features):
        addr = cf['properties'].get('address', '')
        parsed = _parse_addr_parts(addr)
        if parsed:
            h, c = parsed
            addr_lookup[(h, c)] = ci
            by_house.setdefault(h, []).append((c, ci))

    cell_m = max(coord_eq_m, 1.0)
    deg_per_m_lat = 1.0 / 111_320.0
    coord_lookup: dict = {}
    for ci, cf in enumerate(contact_features):
        c_lon, c_lat = cf['geometry']['coordinates']
        deg_per_m_lon = deg_per_m_lat / max(0.05, abs(cos(radians(c_lat))))
        kx = round(c_lon / (cell_m * deg_per_m_lon))
        ky = round(c_lat / (cell_m * deg_per_m_lat))
        coord_lookup.setdefault((kx, ky), []).append(ci)

    used_contacts: set = set()
    matches: dict = {}

    for ii, iaq_f in enumerate(iaq_features):
        q212 = iaq_f['properties'].get('raw_address', '')
        iaq_lon, iaq_lat = iaq_f['geometry']['coordinates']
        matched_ci = None

        if q212:
            parsed = _parse_addr_parts(q212)
            if parsed:
                h, s = parsed
                if (h, s) in addr_lookup:
                    ci = addr_lookup[(h, s)]
                    if ci not in used_contacts:
                        matched_ci = ci
                if matched_ci is None:
                    best_sc, best_ci = 0.0, None
                    for (c_core, ci) in by_house.get(h, []):
                        sc = difflib.SequenceMatcher(None, s, c_core).ratio()
                        if sc > best_sc and ci not in used_contacts:
                            best_sc, best_ci = sc, ci
                    if best_sc >= 0.70 and best_ci is not None:
                        matched_ci = best_ci

        if matched_ci is None:
            deg_per_m_lon = deg_per_m_lat / max(0.05, abs(cos(radians(iaq_lat))))
            kx = round(iaq_lon / (cell_m * deg_per_m_lon))
            ky = round(iaq_lat / (cell_m * deg_per_m_lat))
            for ci in coord_lookup.get((kx, ky), []):
                if ci in used_contacts:
                    continue
                c_lon, c_lat = contact_features[ci]['geometry']['coordinates']
                if _haversine_m(iaq_lat, iaq_lon, c_lat, c_lon) <= coord_eq_m:
                    matched_ci = ci
                    break

        if matched_ci is not None:
            matches[ii] = matched_ci
            used_contacts.add(matched_ci)

    return matches


def _upgrade_contacts_from_iaq(survey_feats: list, iaq_features: list,
                                matches: dict) -> int:
    """
    Apply IAQ↔contact matches in-place.
    - Upgrades contact status to 'Completed' for every matched pair
      (Qualtric response = survey completion regardless of current status).
    - Attaches IAQ summary scores to the contact for popup display.
    - Sets iaq_matched=True on the IAQ feature so the frontend can hide it
      from the IAQ layer (the contact layer already shows the merged point).
    Returns the number of contacts upgraded.
    """
    upgraded = 0
    for iaq_idx, contact_idx in matches.items():
        cf = survey_feats[contact_idx]
        iaq_f = iaq_features[iaq_idx]
        ip = iaq_f['properties']
        ig = iaq_f['geometry']['coordinates']

        cf['properties']['status']           = 'Completed'
        cf['properties']['color']            = STATUS['Completed']
        cf['properties']['has_iaq_survey']   = True
        cf['properties']['iaq_overall_risk'] = ip.get('overall_risk', 0)
        cf['properties']['iaq_risk_tier']    = ip.get('risk_tier', '')
        cf['properties']['iaq_health_score'] = ip.get('health_score', 0)
        cf['properties']['iaq_iaq_score']    = ip.get('iaq_score', 0)
        cf['properties']['iaq_struct_score'] = ip.get('struct_score', 0)
        # Matched IAQ's parcel-rep-point — popup uses this to find the
        # exact IAQ feature for the Survey Answers tab without a
        # distance scan that might pick the wrong neighbour.
        cf['properties']['iaq_match_lon']    = ig[0]
        cf['properties']['iaq_match_lat']    = ig[1]

        iaq_f['properties']['iaq_matched'] = True
        upgraded += 1

    log.info(f"IAQ↔Contact merge: {upgraded}/{len(matches)} contacts upgraded to Completed")
    return upgraded


def tag_contact_match_status(contact_features: list) -> dict:
    """Tag each contact with `match_status` so the dashboard's circle
    stroke can encode the three groups (matched / contact_only / iaq_only).
    Mirror of api/_processing.py:tag_contact_match_status."""
    counts = {'matched': 0, 'contact_only': 0}
    for cf in contact_features:
        p = cf.get('properties') or {}
        status = p.get('status')
        if status == 'Completed':
            if p.get('has_iaq_survey'):
                p['match_status'] = 'matched'
                counts['matched'] += 1
            else:
                p['match_status'] = 'contact_only'
                counts['contact_only'] += 1
        else:
            p.pop('match_status', None)
    return counts


# Status priority for parcel-level dedup. Mirror of
# api/_processing.py:_CONTACT_STATUS_PRIORITY.
_CONTACT_STATUS_PRIORITY = [
    "Completed", "Follow Up", "Left Info",
    "No Answer", "Inaccessible", "Vacant",
    "Not Interested", "Other", "Unknown",
]


def _contact_status_rank(s) -> int:
    try:
        return _CONTACT_STATUS_PRIORITY.index(s or "Unknown")
    except ValueError:
        return len(_CONTACT_STATUS_PRIORITY)


def dedup_contacts_at_parcel(features: list, cell_deg: float = 1e-5) -> list:
    """Collapse community-contact features that share the same parcel
    rep-point. Mirror of api/_processing.py:dedup_contacts_at_parcel —
    see that file for the rationale and tolerance reasoning. Lives
    here so the local-dev `app.py` upload paths produce a blob with
    the same shape (and same dedup) as the Vercel function path.
    """
    if not features:
        return list(features) if features is not None else []

    buckets: dict = {}
    order: list = []
    for f in features:
        try:
            lon, lat = f["geometry"]["coordinates"][:2]
        except (KeyError, IndexError, TypeError):
            order.append(f)
            continue
        if lon is None or lat is None:
            order.append(f)
            continue
        key = (round(lat / cell_deg), round(lon / cell_deg))
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        buckets[key].append(f)

    out: list = []
    for item in order:
        if not isinstance(item, tuple):
            out.append(item)
            continue
        group = buckets[item]
        if len(group) == 1:
            out.append(group[0])
            continue
        # Tie-break on has_iaq_survey so a Completed contact WITH a
        # Qualtric match always wins over a Completed contact without.
        # Mirror of api/_processing.py:dedup_contacts_at_parcel — see
        # that file for the rationale.
        group.sort(key=lambda f: (
            _contact_status_rank((f.get("properties") or {}).get("status")),
            0 if (f.get("properties") or {}).get("has_iaq_survey") else 1,
        ))
        winner = group[0]
        losers = group[1:]
        wp = winner.setdefault("properties", {})
        # Carry IAQ-match info from any matched loser onto the winner
        # so the popup's "Qualtric matched" badge + Survey Answers tab
        # still resolve at this parcel.
        if not wp.get("has_iaq_survey"):
            for l in losers:
                lp = l.get("properties") or {}
                if lp.get("has_iaq_survey"):
                    wp["has_iaq_survey"] = True
                    if lp.get("iaq_match_lon") is not None:
                        wp["iaq_match_lon"] = lp["iaq_match_lon"]
                    if lp.get("iaq_match_lat") is not None:
                        wp["iaq_match_lat"] = lp["iaq_match_lat"]
                    for k in ("iaq_overall_risk", "iaq_health_score",
                              "iaq_iaq_score", "iaq_struct_score",
                              "iaq_risk_tier"):
                        if lp.get(k) is not None and wp.get(k) is None:
                            wp[k] = lp[k]
                    break
        existing = wp.get("coincident_contacts") or []
        wp["coincident_contacts"] = existing + [
            {
                "status":       (l.get("properties") or {}).get("status"),
                "street_name":  (l.get("properties") or {}).get("street_name"),
                "notes":        (l.get("properties") or {}).get("notes"),
                "collected_at": (l.get("properties") or {}).get("collected_at"),
                "source":       (l.get("properties") or {}).get("source"),
                "has_iaq_survey": bool((l.get("properties") or {}).get("has_iaq_survey")),
            }
            for l in losers
        ]
        out.append(winner)
    return out


def _apply_iaq_to_field_features(field_features: list, iaq_features: list,
                                  fallback_m: float = 30) -> int:
    """
    Upgrade field survey point status to Completed when an IAQ survey
    exists for the same parcel.

    v3 algorithm (2026-05-05) — parcel-aware. Uses module-level parcel
    helpers _parcel_strtree / _parcel_geoms_list when available (i.e.
    `app.py` is running with parcels loaded). Falls back to a
    conservative 30 m haversine when parcel data isn't loaded.

    Tier 1: snap field GPS to its parcel rep-point → match IAQ at
            that exact coord (within 1 m, deterministic).
    Tier 2: distance ≤ fallback_m (only when parcel index unavailable
            or field pin sits outside any parcel).

    Returns the number of field points upgraded.
    """
    if not iaq_features:
        return 0
    upgraded = 0
    parcel_available = bool(_parcel_strtree is not None and _parcel_geoms_list)
    for ff in field_features:
        if ff['properties'].get('status') == 'Completed':
            continue
        f_lon, f_lat = ff['geometry']['coordinates']
        match_iaq = None

        if parcel_available:
            # Snap field GPS to parcel rep-point (≤50 m).
            from shapely.geometry import Point as _Pt
            search_r = 50.0 / 111_320.0
            try:
                idxs = _parcel_strtree.query(_Pt(f_lon, f_lat).buffer(search_r))
            except Exception:
                idxs = []
            best_dist, best = float('inf'), None
            for idx in idxs:
                _, p_lon, p_lat = _parcel_geoms_list[int(idx)]
                d = _haversine_m(f_lat, f_lon, p_lat, p_lon)
                if d < best_dist:
                    best_dist, best = d, (p_lon, p_lat)
            if best and best_dist <= 50.0:
                p_lon, p_lat = best
                for iaq_f in iaq_features:
                    i_lon, i_lat = iaq_f['geometry']['coordinates']
                    if _haversine_m(p_lat, p_lon, i_lat, i_lon) <= 1.0:
                        match_iaq = iaq_f
                        break

        if match_iaq is None:
            for iaq_f in iaq_features:
                i_lon, i_lat = iaq_f['geometry']['coordinates']
                if _haversine_m(f_lat, f_lon, i_lat, i_lon) <= fallback_m:
                    match_iaq = iaq_f
                    break

        if match_iaq is not None:
            ip = match_iaq['properties']
            ig = match_iaq['geometry']['coordinates']
            ff['properties']['status']           = 'Completed'
            ff['properties']['color']            = STATUS['Completed']
            ff['properties']['has_iaq_survey']   = True
            ff['properties']['iaq_overall_risk'] = ip.get('overall_risk', 0)
            ff['properties']['iaq_risk_tier']    = ip.get('risk_tier', '')
            ff['properties']['iaq_health_score'] = ip.get('health_score', 0)
            ff['properties']['iaq_iaq_score']    = ip.get('iaq_score', 0)
            ff['properties']['iaq_struct_score'] = ip.get('struct_score', 0)
            ff['properties']['iaq_match_lon']    = ig[0]
            ff['properties']['iaq_match_lat']    = ig[1]
            upgraded += 1
    log.info(f"Field↔IAQ merge: {upgraded} field points upgraded to Completed")
    return upgraded


# ── IAQ survey pipeline ────────────────────────────────────────────────────────

# Local mirror of api/_processing.EXPECTED_IAQ_COLUMNS. Kept in sync manually
# until app.py and _processing.py share a single source of truth.
_EXPECTED_IAQ_COLUMNS_LOCAL = {
    'critical': ['Finished', 'Q212', 'LocationLatitude', 'LocationLongitude'],
    'health':   ['Headache', 'RespIll', 'asthma', 'wheeze', 'Tired',
                 'Hospital Respiratory'],
    'iaq':      ['Mold',
                 'Leakage 2_1', 'Leakage 2_2', 'Leakage 2_3', 'Leakage 2_4',
                 'Cooling System _1', 'Cooling System _2',
                 'Cooling System _3', 'Cooling System _4',
                 'Cooking '],
    'struct':   ['QID192', 'QID128', 'QID141'],
}


def _validate_iaq_columns_local(df_columns) -> dict:
    have = {str(c).replace('\xa0', ' ').strip() for c in df_columns}
    missing = {}
    for group, cols in _EXPECTED_IAQ_COLUMNS_LOCAL.items():
        gone = [c for c in cols if c.replace('\xa0', ' ').strip() not in have]
        if gone:
            missing[group] = gone
    return missing


# ── Survey-question metadata (local mirror of api/_processing.SURVEY_QUESTIONS) ──
# Maps a normalized field_name → (orig_csv_col_idx, question_text). Pinned by
# original CSV column index because many of these columns export with blank
# or duplicate Qualtrics headers (matrix sub-items as ' _1', ' _2', …; some
# standalone questions ship with a literal single-space header). Question text
# comes from the descriptor row of the CSV — used for chart subtitles in the
# dashboard. Must stay in sync with the Vercel-side dict; verified via
# scripts/verify_parity.py.
# Mirror of api/_processing.py:SURVEY_QUESTIONS — see that file for the
# QID-first lookup rationale. Tuple is (fallback_csv_idx, primary_qid,
# canonical_text).
SURVEY_QUESTIONS = {
    # ── Residency & Housing (R1–R8) ───────────────────────────────────────────
    'years_in_hre':       (27,  'QID12_TEXT', 'How long have you lived in High Ridge Estates? (years)'),
    'reloc_factor_emp':   (29,  'QID181_1',   'Relocation factor — Employment opportunities nearby'),
    'reloc_factor_aff':   (30,  'QID181_2',   'Relocation factor — Affordable housing'),
    'reloc_factor_qol':   (31,  'QID181_3',   'Relocation factor — Quality of Life'),
    'reloc_factor_fam':   (32,  'QID181_4',   'Relocation factor — Proximity to family and friends'),
    'reloc_factor_ret':   (33,  'QID181_5',   'Relocation factor — Retirement'),
    'reloc_factor_env':   (34,  'QID181_6',   'Relocation factor — Environmental quality and access to nature'),
    'reloc_factor_inh':   (35,  'QID181_7',   'Relocation factor — Inherited property'),
    'reloc_factor_oth':   (36,  'QID181_8',   'Relocation factor — Other'),
    'mh_skirting':        (42,  'QID100',     'If you live in a mobile home, does your home have its skirting intact?'),
    'anticipated_stay':   (44,  'QID47',      'How long do you anticipate continuing to live in your current house?'),
    'safety_env':         (56,  'QID21',      'Do you feel safe in your house in terms of environmental threats (flooding, heatwaves, heavy rain/wind)?'),
    'safety_social':      (57,  'QID194',     'Do you feel safe in your house in terms of social threats (loose pets, concerns about neighbors, etc.)?'),
    'afford_urgency':     (58,  'QID17',      'How would you rate the urgency of having affordable housing in High Ridge Estates?'),
    'afford_strategy':    (59,  'QID19',      'In your opinion, what is the most effective strategy to improve housing affordability in HRE?'),

    # ── Community Living: home-resilience interventions matrix (C1, 11 items) ─
    'intv_roof_walls':    (67,  'QID195_1',   'Intervention — Strengthen the roof and walls against severe weather'),
    'intv_windows_doors': (68,  'QID195_2',   'Intervention — Upgrade windows and doors to be more energy-efficient'),
    'intv_rain_gardens':  (69,  'QID195_3',   'Intervention — Install rain gardens to manage stormwater on my property'),
    'intv_hvac':          (70,  'QID195_4',   'Intervention — Improve heating/cooling system(s)'),
    'intv_plumbing_elec': (71,  'QID195_5',   'Intervention — Improve plumbing or electrical systems for reliability'),
    'intv_well_septic':   (72,  'QID195_6',   'Intervention — Replace well/septic'),
    'intv_ccua_water':    (73,  'QID195_7',   'Intervention — Connect to city water through CCUA'),
    'intv_fence':         (74,  'QID195_8',   'Intervention — Add a fence for safety'),
    'intv_trees_shade':   (75,  'QID195_9',   'Intervention — Plant more trees around my home for shade and cooling'),
    'intv_trim_trees':    (76,  'QID195_10',  'Intervention — Trim trees'),
    'intv_drainage':      (77,  'QID195_11',  'Intervention — Improved drainage'),

    # ── Community Living: experiences in HRE matrix (C2, 10 items) ────────────
    'exp_flooding':        (84, 'QID124_1',   'Experience — Flooding of house due to any disaster (e.g., hurricane)'),
    'exp_flood_help':      (85, 'QID124_2',   'Experience — In case of flooding, received help for cleaning'),
    'exp_extreme_heat':    (86, 'QID124_3',   'Experience — Extreme heat in recent years'),
    'exp_school_change':   (87, 'QID124_4',   "Experience — Changing your kids' school due to moving"),
    'exp_law_enf':         (88, 'QID124_5',   'Experience — Calling law enforcement because of problem with neighbors'),
    'exp_insurance_loss':  (89, 'QID124_6',   'Experience — Losing home owners insurance due to age of home'),
    'exp_well_dry':        (90, 'QID124_7',   'Experience — Well drying up'),
    'exp_pests':           (91, 'QID124_8',   'Experience — A problem with pests in your home'),
    'exp_water_leaks':     (92, 'QID124_9',   'Experience — A problem with water leaks'),
    'exp_loose_animals':   (93, 'QID124_10',  'Experience — A problem with loose animals'),

    # ── Well-being & Mobility (W1, W2) ────────────────────────────────────────
    'car_access':          (133, 'QID211',    'Do you (or your household) own or have regular access to a car?'),
    'hurricane_transport': (134, 'QID219',    'During hurricanes/disasters, have you experienced transportation problems (e.g., difficulty evacuating)?'),

    # ── Demographics+ (D1, D2) ────────────────────────────────────────────────
    'education':           (142, 'QID178',    'What is the highest level of education you have completed?'),
    'employment':          (143, 'QID176',    'Which best describes your employment status?'),
}

INTERVENTION_HIGHLIGHTS = ('intv_roof_walls', 'intv_ccua_water')
EXPERIENCE_HIGHLIGHTS = ('exp_law_enf', 'exp_insurance_loss', 'exp_well_dry',
                         'exp_pests', 'exp_water_leaks', 'exp_loose_animals')

INTERVENTION_FIELDS = (
    'intv_roof_walls', 'intv_windows_doors', 'intv_rain_gardens',
    'intv_hvac', 'intv_plumbing_elec', 'intv_well_septic',
    'intv_ccua_water', 'intv_fence', 'intv_trees_shade',
    'intv_trim_trees', 'intv_drainage',
)
EXPERIENCE_FIELDS = (
    'exp_flooding', 'exp_flood_help', 'exp_extreme_heat', 'exp_school_change',
    'exp_law_enf', 'exp_insurance_loss', 'exp_well_dry',
    'exp_pests', 'exp_water_leaks', 'exp_loose_animals',
)
RELOC_FIELDS = (
    'reloc_factor_emp', 'reloc_factor_aff', 'reloc_factor_qol',
    'reloc_factor_fam', 'reloc_factor_ret', 'reloc_factor_env',
    'reloc_factor_inh', 'reloc_factor_oth',
)

CHART_SOURCES = {
    # ── Overview ─────────────────────────────────────────────────────────────
    'mean_risk':        'derived: 0.35·Health + 0.35·IAQ + 0.30·Structural — Mean Risk composite',
    'mean_health':      'composite Health: Headache + RespIll + asthma + wheeze + Tired (×weights) + Hospital Respiratory (+20)',
    'mean_iaq':         'composite IAQ: Mold + Leakage 2_1..4 + Cooling System _1..4 + Cooking',
    'mean_struct':      'composite Structural: QID192 (year built) + QID128 (housing type) + QID141 (condition)',
    'risk_tiers':       'derived from mean_risk — Low <34 / Medium 34–66 / High ≥67',
    'ownership':        'Ownership (CSV col) — "What is your current housing ownership status?"',
    # ── Health ───────────────────────────────────────────────────────────────
    'symptoms':         'symptom prevalence: RespIll + asthma + wheeze + Mold + Hospital Respiratory',
    'respiratory_pct':  'RespIll — "How often does anyone in your home have respiratory illness symptoms?" (Health input)',
    'asthma_pct':       'asthma — "How often does anyone in your home have asthma symptoms?" (Health input)',
    'wheeze_pct':       'wheeze — "How often does anyone in your home wheeze?" (Health input)',
    'mold_pct':         'Mold — "Evidence of mold in any area of the home?" (IAQ input, +30 pts)',
    'hospital_pct':     'Hospital Respiratory — "Has anyone in your home visited a hospital for respiratory issues?" (Health +20)',
    # ── IAQ ──────────────────────────────────────────────────────────────────
    'mold_by_street':   'Mold — aggregated per street (≥3 responses)',
    'year_built':       'QID192 — "When was your house built?" (Structural input)',
    # ── Structural ───────────────────────────────────────────────────────────
    'housing_types':    'QID128 — "What type of house do you live in?" (Structural input)',
    'conditions':       'QID141 — "How would you describe the condition of your current house in terms of maintenance and repair?" (Structural input)',
    'struct_by_street': 'composite QID192 + QID128 + QID141 — Structural score per street (≥3 responses)',
    # ── Streets ──────────────────────────────────────────────────────────────
    'risk_by_street':   'composite overall_risk — aggregated per street (≥3 responses)',
    'compare_street':   'mean Health, IAQ, Structural — aggregated per street (≥3 responses)',
    # ── Validation (data-quality metrics, not survey questions) ──────────────
    'coord_source':     'derived from geocoding tier (Q212 → parcel match / fuzzy / Census) — data-quality metric',
    'unmatched':        'derived: IAQ rows with no community-contact match — data-quality metric',
    'match_rate':       'derived: % of community contacts upgraded by IAQ — data-quality metric',
    # ── Residency & Housing ──────────────────────────────────────────────────
    'years_in_hre':       'QID12_TEXT — "How long have you lived in High Ridge Estates? (years)"',
    'anticipated_stay':   'QID47 — "How long do you anticipate continuing to live in your current house?"',
    'mh_skirting':        'QID100 — "If you live in a mobile home, does your home have its skirting intact?"',
    'safety_env':         'QID21 — "Do you feel safe in your house in terms of environmental threats (flooding, heatwaves, heavy rain/wind)?"',
    'safety_social':      'QID194 — "Do you feel safe in your house in terms of social threats (loose pets, concerns about neighbors, etc.)?"',
    'afford_urgency':     'QID17 — "How would you rate the urgency of having affordable housing in HRE?"',
    'afford_strategy':    'QID19 — "What is the most effective strategy to improve housing affordability in HRE?"',
    'reloc_factors':      'QID181_1..8 matrix — relocation-factor importance (Employment / Affordability / Quality of Life / Family / Retirement / Environment / Inheritance / Other)',
    # ── Community living matrix charts ───────────────────────────────────────
    'interventions_pct':  'QID195_1..11 matrix — % wanting each home-resilience intervention (roof/walls, windows/doors, rain gardens, HVAC, plumbing/elec, well/septic, CCUA water, fence, trees-shade, trim trees, drainage). Likert 1–7; counts answers > scale-midpoint as positive.',
    'experiences_pct':    'QID124_1..10 matrix — % reporting each HRE experience (flooding, flood help, extreme heat, school change, law enforcement, insurance loss, well drying, pests, water leaks, loose animals). Likert 1–7; counts answers > scale-midpoint as positive.',
    # ── Well-being & Mobility ────────────────────────────────────────────────
    'car_access':         'QID211 — "Do you (or your household) own or have regular access to a car?"',
    'hurricane_transport':'QID219 — "During hurricanes/disasters, have you experienced transportation problems (e.g., difficulty evacuating)?"',
    # ── Demographics+ ────────────────────────────────────────────────────────
    'education':          'QID178 — "What is the highest level of education you have completed?"',
    'employment':         'QID176 — "Which best describes your employment status?"',
}


def _val_at_orig_idx(full_row, orig_idx):
    """Pull a raw cell value from the pre-PII-drop DataFrame row by ORIGINAL
    CSV column index. Used for blank-header / duplicate-header columns where
    name-based lookup is unreliable. Returns clean string ('' on miss/NaN)."""
    try:
        v = full_row.iloc[orig_idx]
    except (IndexError, KeyError, AttributeError):
        return ''
    if v is None or pd.isna(v):
        return ''
    s = str(v).strip()
    return '' if s.lower() in ('nan', 'none') else s


def _parse_years_numeric(v):
    """Parse a free-text years answer into a float; None on failure."""
    if v is None:
        return None
    s = str(v).strip().lower()
    if not s or s in ('nan', 'none'):
        return None
    s = (s.replace('years', '').replace('year', '')
          .replace('yrs', '').replace('yr', '')
          .strip().rstrip('+').strip())
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _extract_survey_extras(full_row, qid_to_col_idx: dict | None = None) -> dict:
    """Mirror of api/_processing.py:_extract_survey_extras — see that
    file for the QID-first lookup rationale."""
    qmap = qid_to_col_idx or {}
    out: dict = {}
    for field, meta in SURVEY_QUESTIONS.items():
        if len(meta) == 3:
            idx, qid, _text = meta
        else:
            idx, _text = meta
            qid = None
        col = qmap.get(qid) if qid else None
        if col is None and qid:
            base = qid[:-5] if qid.endswith('_TEXT') else qid
            col = qmap.get(base)
        if col is None:
            col = idx
        out[field] = _val_at_orig_idx(full_row, col)
    out['years_in_hre_num'] = _parse_years_numeric(out.get('years_in_hre'))
    return out


def _read_qualtric_csv(file_bytes: bytes):
    """Encoding-tolerant Qualtric CSV reader with two-row-header auto-detection.
    Mirrors api/_processing._read_qualtric_csv so local and Vercel parse identically."""
    if not file_bytes:
        raise ValueError("Empty CSV body — no bytes received.")
    if file_bytes[:3] == b'\xef\xbb\xbf':
        file_bytes = file_bytes[3:]
    encodings = ('utf-8-sig', 'utf-8', 'utf-16', 'cp1252', 'latin-1')
    last_err = None
    head = None
    used_enc = None
    for enc in encodings:
        try:
            head = pd.read_csv(io.BytesIO(file_bytes), encoding=enc,
                               nrows=4, header=None, dtype=str,
                               keep_default_na=False, low_memory=False)
            used_enc = enc
            break
        except (UnicodeDecodeError, UnicodeError) as e:
            last_err = e
        except Exception as e:
            last_err = e
    if head is None or used_enc is None:
        raise ValueError(
            f"Cannot decode CSV (tried {', '.join(encodings)}). "
            f"Last error: {last_err}. Re-export from Qualtrics as CSV (UTF-8)."
        )
    skip = []
    row2_has_importid = (
        len(head) > 2
        and 'ImportId' in ' '.join(str(v) for v in head.iloc[2].tolist())
    )
    if len(head) > 1:
        row1 = ' '.join(str(v) for v in head.iloc[1].tolist())
        if row2_has_importid or 'ImportId' in row1 or any(
            len(str(v)) > 40 for v in head.iloc[1].tolist()
        ):
            skip.append(1)
    if row2_has_importid:
        skip.append(2)
    raw = (pd.read_csv(io.BytesIO(file_bytes), encoding=used_enc,
                       skiprows=skip, low_memory=False) if skip
           else pd.read_csv(io.BytesIO(file_bytes), encoding=used_enc, low_memory=False))

    # Build qid -> col-idx map from the ImportId metadata row so
    # downstream extraction is robust to column shuffling between
    # Qualtrics survey versions. Mirror of api/_processing.py.
    qid_to_col_idx: dict = {}
    if row2_has_importid:
        meta_row = head.iloc[2].tolist()
        for col_idx, cell in enumerate(meta_row):
            if not isinstance(cell, str) or 'ImportId' not in cell:
                continue
            try:
                m = json.loads(cell)
                qid = m.get('ImportId') if isinstance(m, dict) else None
            except (json.JSONDecodeError, ValueError):
                _re_match = re.search(r'"ImportId"\s*:\s*"([^"]+)"', cell)
                qid = _re_match.group(1) if _re_match else None
            if not qid:
                continue
            qid_to_col_idx.setdefault(qid, col_idx)
            base = qid[:-5] if qid.endswith('_TEXT') else qid
            qid_to_col_idx.setdefault(base, col_idx)
    return raw, qid_to_col_idx


def process_iaq_survey(csv_bytes: bytes):
    """
    Process Qualtrics IAQ survey CSV entirely in memory (never written to disk).

    Qualtrics CSV structure:
      Row 0  – machine column names  → header
      Row 1  – human-readable labels → skip (auto-detected)
      Row 2  – ImportId metadata     → skip (auto-detected)
      Row 3+ – actual survey data

    Returns (geojson, analysis, street_stats, validation).
    `analysis['validation_warnings']` is populated when expected Qualtrics
    columns are missing — same shape as the Vercel `process_iaq_bytes`
    so the dashboard reads a single, deterministic schema regardless of
    which deployment processed the upload.
    """
    raw, qid_to_col_idx = _read_qualtric_csv(csv_bytes)
    if 'Finished' not in raw.columns:
        raise ValueError(
            "CSV is missing the 'Finished' column. "
            "Re-export: Qualtrics → Data → Export & Import → Export Data → CSV."
        )

    # Column-manifest validation (parity with api/_processing.py).
    missing_columns = _validate_iaq_columns_local(raw.columns)
    if missing_columns:
        log.warning(f"IAQ: missing Qualtrics columns: {missing_columns}")
    _fin = raw['Finished'].astype(str).str.strip().str.lower()
    _mask = _fin.isin(['true', '1'])
    # df_full keeps every column (incl. PII + blank/duplicate-named matrix
    # columns) so we can index by ORIGINAL CSV position for SURVEY_QUESTIONS.
    # df strips PII columns and is what existing name-based code reads.
    df_full = raw[_mask].copy().reset_index(drop=True)
    if df_full.empty:
        log.warning(
            f"IAQ: empty after Finished filter — sample values: "
            f"{list(raw['Finished'].astype(str).unique()[:8])}"
        )
        raise ValueError(
            "No completed responses found in the CSV. "
            "Only rows where Finished='True' or Finished=1 are processed."
        )

    numeric_recode_mode = _is_numeric_recode_export(df_full, qid_to_col_idx)
    log.info(
        "IAQ: applying QSF label harmonisation (detected_numeric_export=%s)",
        numeric_recode_mode,
    )
    _apply_qsf_recode_labels(df_full, qid_to_col_idx)

    log.info(f"IAQ survey: {len(df_full)}/{len(raw)} finished responses")
    df = df_full.copy()

    # Drop PII immediately
    df.drop(columns=[c for c in PII_COLS if c in df.columns], inplace=True)

    features = []
    address_matched = 0
    geocode_fallbacks = 0
    geocode_fails = 0

    # Build lookup from already-geocoded community contact points (loaded at startup)
    contact_lookup = _build_contact_lookup(survey_data.get('features', []) if survey_data else [])
    log.info(f"IAQ: contact lookup has {len(contact_lookup)} geocoded addresses for matching")

    # Canonical street name index: used to correct typos in Q212 for ALL respondents
    # (including GPS respondents whose coordinates are fine but whose typed street
    # name may be misspelled, e.g. "Hrvard Ave" → "Harvard Ave").
    known_streets = _build_known_streets(contact_lookup)
    log.info(f"IAQ: {len(known_streets)} canonical street names loaded for typo correction")

    for i, (_, row) in enumerate(df.iterrows()):
        # Extract survey-question fields by ORIGINAL CSV column index from
        # the pre-PII-drop row; matches indices in SURVEY_QUESTIONS.
        survey_extras = _extract_survey_extras(df_full.iloc[i], qid_to_col_idx)
        health = _compute_health_score(row)
        iaq = _compute_iaq_score(row)
        struct = _compute_struct_score(row)
        risk = round(0.35 * health + 0.35 * iaq + 0.30 * struct)

        tier = ('Low' if risk < 34 else 'Medium' if risk < 67 else 'High')
        tier_color = '#10b981' if tier == 'Low' else ('#f97316' if tier == 'Medium' else '#ef4444')

        # Address → street name only (house number removed for privacy)
        q212 = row.get('Q212', '')
        street_name = _extract_street_name(q212) or 'Unknown'
        # Correct typos / alternate spellings against the known contact street list.
        # Works for GPS respondents too — their coordinates are used for the map but
        # the street group name still comes from Q212 and may contain a typo.
        street_name = _canonicalize_street(street_name, known_streets)

        # ── ADDRESS-ONLY GEOCODING (v3, 2026-05-05) ───────────────────
        # The Qualtrics LocationLatitude/Longitude is *where the
        # respondent submitted the survey*, not their home. We never
        # use it. Both community contacts and IAQ are reduced to the
        # same canonical form: parcel rep-point of the typed address.
        coords = None
        coord_source = 'none'
        q212_str = ' '.join(str(q212).split()) if q212 else ''
        if q212_str and q212_str.lower() not in ('', 'ttt', 'nan', 'read to respondent'):
            lng_m, lat_m, matched_addr, match_type = _address_match(q212_str, contact_lookup)
            if lng_m is not None:
                coords = [round(float(lng_m), 6), round(float(lat_m), 6)]
                coord_source = 'address_matched'
                address_matched += 1
                street_name = _extract_street_name(matched_addr) or street_name
                log.debug(f"  addr match ({match_type}): {q212_str!r} → {matched_addr!r}")
            else:
                geocode_fallbacks += 1
                lng_g, lat_g, matched, _gsrc = _parcel_geocode(q212_str)
                coord_source = _gsrc
                if lng_g is not None:
                    coords = [round(float(lng_g), 6), round(float(lat_g), 6)]
                    if street_name == 'Unknown':
                        street_name = _extract_street_name(matched or '') or 'Unknown'
                    if _gsrc in ('geocoded', 'parcel_snapped'):
                        time.sleep(0.25)

        if coords is None:
            geocode_fails += 1
            log.warning(f"[geocode] FAILED iaq: '{str(q212)[:80]}'")
            continue

        # Anonymised properties — no name, no email, no full address
        mold_val = row.get('Mold')
        has_mold = bool(mold_val and not pd.isna(mold_val) and
                        str(mold_val).strip() not in ('', 'nan'))

        ow_raw = str(row.get('Ownership', '') or '').lower()
        ownership = 'Owner' if 'owner' in ow_raw else ('Renter' if 'renter' in ow_raw else 'Other')
        _row_nr = {str(k).replace('\xa0', ' '): v for k, v in row.items()}

        features.append({
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': coords},
            'properties': {
                'street_name':        street_name,
                'health_score':       health,
                'iaq_score':          iaq,
                'struct_score':       struct,
                'overall_risk':       risk,
                'risk_tier':          tier,
                'color':              tier_color,
                'ownership':          ownership,
                'housing_type':       str(_row_nr.get('QID128', '') or ''),
                'year_built':         str(_row_nr.get('QID192', '') or ''),
                'condition':          str(_row_nr.get('QID141', '') or ''),
                'has_mold':           has_mold,
                'respiratory_ill':    str(_row_nr.get('RespIll', '')  or ''),
                'asthma_freq':        str(_row_nr.get('asthma', '')   or ''),
                'wheeze_freq':        str(_row_nr.get('wheeze', '')   or ''),
                'headache_freq':      str(_row_nr.get('Headache', '') or ''),
                'tired_freq':         str(_row_nr.get('Tired', '')    or ''),
                'hospital_visit':     ('yes' if 'yes' in str(
                    _row_nr.get('Hospital Respiratory', '') or '').lower() else 'no'),
                'leakage_roof':       str(_row_nr.get('Leakage 2_1', '')       or ''),
                'leakage_walls':      str(_row_nr.get('Leakage 2_2', '')       or ''),
                'leakage_windows':    str(_row_nr.get('Leakage 2_3', '')       or ''),
                'leakage_floor':      str(_row_nr.get('Leakage 2_4', '')       or ''),
                'cooling_central_ac': str(_row_nr.get('Cooling System _1', '') or ''),
                'cooling_window_unit':str(_row_nr.get('Cooling System _2', '') or ''),
                'cooling_fan':        str(_row_nr.get('Cooling System _3', '') or ''),
                'cooling_none':       str(_row_nr.get('Cooling System _4', '') or ''),
                'cooking_method':     str(_row_nr.get('Cooking ', '')           or ''),
                'coord_source':       coord_source,
                'raw_address':        ' '.join(str(q212).split()) if q212 and str(q212).strip().lower() not in ('', 'ttt', 'nan', 'read to respondent') else '',
                'iaq_matched':        False,
                **survey_extras,
            }
        })

    log.info(f"IAQ: {len(features)} placed on map — "
             f"GPS: {len(features) - address_matched - geocode_fallbacks + geocode_fails}, "
             f"address-matched: {address_matched}, "
             f"Census geocoded: {geocode_fallbacks - geocode_fails}, "
             f"failed/skipped: {geocode_fails}")

    # Per-respondent SURVEY_QUESTIONS answers are RETAINED on each IAQ feature
    # so the dashboard's contact-point popup can render a "Survey Answers" tab
    # by spatial-matching the clicked contact to its IAQ feature in iaqData.
    # raw_address is preserved here because _cross_validate() needs it; it is
    # stripped at the upload-endpoint level. The numeric helper years_in_hre_num
    # is dropped (analysis-only).
    analysis_result = _compute_iaq_analysis(features)
    analysis_result['input_format'] = (
        'numeric_recode' if numeric_recode_mode else 'text_labels'
    )
    analysis_result['recode_translation_applied'] = True
    for f in features:
        f['properties'].pop('years_in_hre_num', None)
    geojson = {'type': 'FeatureCollection', 'features': features}
    if missing_columns:
        analysis_result['validation_warnings'] = {
            'missing_columns': missing_columns,
            'message': (
                'Some expected Qualtrics columns are missing — affected scores '
                'default to 0. Verify the export format.'
            ),
        }
    streets = _compute_street_stats(features)
    validation = _cross_validate(features)
    return geojson, analysis_result, streets, validation


def _compute_iaq_analysis(features):
    """Overview statistics from IAQ survey feature list."""
    if not features:
        return {}
    n = len(features)
    props = [f['properties'] for f in features]

    def _mean(lst):
        return round(sum(lst) / len(lst), 1) if lst else 0

    def _pct_active(field):
        active = ('weekly', 'month', 'season')
        return round(
            sum(1 for p in props
                if any(kw in str(p.get(field, '') or '').lower() for kw in active)) / n * 100, 1)

    risks = [p['overall_risk'] for p in props]

    htypes = defaultdict(int)
    for p in props:
        ht = str(p.get('housing_type', '') or '').lower()
        if 'single wide' in ht:
            htypes['Single Wide'] += 1
        elif 'double wide' in ht:
            htypes['Double Wide'] += 1
        elif 'site' in ht and 'built' in ht:
            htypes['Site Built'] += 1
        else:
            htypes['Other'] += 1

    conds = defaultdict(int)
    for p in props:
        c = str(p.get('condition', '') or '').lower()
        if 'good' in c:
            conds['Good'] += 1
        elif 'fair' in c:
            conds['Fair'] += 1
        elif 'poor' in c:
            conds['Poor'] += 1
        elif 'critical' in c or 'uninhabitable' in c:
            conds['Critical'] += 1
        else:
            conds['Unknown'] += 1

    yr_dist = defaultdict(int)
    for p in props:
        y = str(p.get('year_built', '') or '').lower()
        if 'before 1960' in y:
            yr_dist['Before 1960'] += 1
        elif '1960' in y:
            yr_dist['1960–1979'] += 1
        elif '1980' in y:
            yr_dist['1980–1999'] += 1
        elif '2000' in y:
            yr_dist['2000+'] += 1
        else:
            yr_dist['Unknown'] += 1

    owners = sum(1 for p in props if p.get('ownership') == 'Owner')
    renters = sum(1 for p in props if p.get('ownership') == 'Renter')

    # ── New survey-question aggregations (R/C/W/D blocks) ─────────────────────
    def _bin_counts(field):
        c = defaultdict(int)
        for p in props:
            v = str(p.get(field, '') or '').strip()
            if v:
                c[v] += 1
        return dict(c)

    def _yes_no_counts(field):
        out = {'yes': 0, 'no': 0, 'not_sure': 0, 'other': 0, 'na': 0}
        for p in props:
            v = str(p.get(field, '') or '').strip().lower()
            if not v:
                out['na'] += 1
            elif v == 'yes':
                out['yes'] += 1
            elif v == 'no':
                out['no'] += 1
            elif 'not sure' in v:
                out['not_sure'] += 1
            else:
                out['other'] += 1
        return out

    # Mirror of api/_processing.py — see that file for the rationale.
    # Production Qualtrics export stores matrix answers as integers
    # (1–5, 1–6, 1–7 Likert depending on the question). Predicates
    # accept BOTH numeric (>midpoint) AND text (yes/want/Daily/etc.)
    # forms or any Community / Experiences chart silently zeros out.
    _NEGATIVE_TOKENS = (
        'not ', "don't", 'do not', 'never', 'no - ', 'no, ',
        'strongly disagree', 'somewhat disagree', 'disagree',
        'dislike',  # prevents 'like' in 'dislike' false-positive
    )
    _AFFIRM_TOKENS = ('yes', 'agree', 'true')
    _POSITIVE_WANT_TOKENS = (
        'want', 'like', 'agree', 'strongly', 'somewhat', 'definitely',
        'yes', 'true', 'interested',
    )
    _FREQUENCY_TOKENS = (
        'daily', 'weekly', 'biweekly', 'bi-weekly', 'monthly',
        'quarterly', 'yearly', 'annually', 'often', 'sometimes',
        'occasionally', 'every',
    )

    def _is_negative_text(v: str) -> bool:
        return any(t in v for t in _NEGATIVE_TOKENS)

    def _try_num(v):
        if v is None:
            return None
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return float(v)
        s = str(v).strip()
        if not s:
            return None
        try:
            return float(s)
        except (ValueError, TypeError):
            return None

    def _scale_max(field):
        m = 0
        for p in props:
            x = _try_num(p.get(field))
            if x is not None and x > m:
                m = x
        return m if m >= 2 else 5

    def _pct_positive(field, positive_text_tokens):
        if not n:
            return 0.0
        smax = _scale_max(field)
        threshold = max(smax / 2.0, 3.5)
        hits = 0
        for p in props:
            raw = p.get(field)
            x = _try_num(raw)
            if x is not None:
                if x > threshold:
                    hits += 1
                continue
            v = str(raw or '').lower().strip()
            if not v or _is_negative_text(v):
                continue
            if any(t in v for t in positive_text_tokens):
                hits += 1
        return round(hits / n * 100, 1)

    def _pct_yes(field):
        return _pct_positive(field, _AFFIRM_TOKENS + _FREQUENCY_TOKENS)

    def _pct_want(field):
        return _pct_positive(field, _POSITIVE_WANT_TOKENS)

    yrs_vals = [p['years_in_hre_num'] for p in props
                if isinstance(p.get('years_in_hre_num'), (int, float))]
    yrs_n = len(yrs_vals)
    yrs_sorted = sorted(yrs_vals)
    yrs_mean = round(sum(yrs_vals) / yrs_n, 1) if yrs_n else 0
    yrs_median = (yrs_sorted[yrs_n // 2] if yrs_n % 2
                  else (yrs_sorted[yrs_n // 2 - 1] + yrs_sorted[yrs_n // 2]) / 2) if yrs_n else 0
    yrs_bins = defaultdict(int)
    for v in yrs_vals:
        if v < 1:    yrs_bins['<1 yr'] += 1
        elif v < 5:  yrs_bins['1–4'] += 1
        elif v < 10: yrs_bins['5–9'] += 1
        elif v < 20: yrs_bins['10–19'] += 1
        elif v < 30: yrs_bins['20–29'] += 1
        else:        yrs_bins['30+'] += 1

    return {
        'n_responses': n,
        'geocoded': n,
        'scores': {
            'mean_risk':   _mean(risks),
            'mean_health': _mean([p['health_score'] for p in props]),
            'mean_iaq':    _mean([p['iaq_score'] for p in props]),
            'mean_struct': _mean([p['struct_score'] for p in props]),
        },
        'risk_tiers': {
            'low':    sum(1 for r in risks if r < 34),
            'medium': sum(1 for r in risks if 34 <= r < 67),
            'high':   sum(1 for r in risks if r >= 67),
        },
        'health': {
            'respiratory_pct': _pct_active('respiratory_ill'),
            'asthma_pct':      _pct_active('asthma_freq'),
            'wheeze_pct':      _pct_active('wheeze_freq'),
            'mold_pct': round(sum(1 for p in props if p.get('has_mold')) / n * 100, 1),
            'hospital_pct': round(
                sum(1 for p in props if p.get('hospital_visit') == 'yes') / n * 100, 1),
        },
        'housing': {
            'types':      dict(htypes),
            'conditions': dict(conds),
            'year_built': dict(yr_dist),
        },
        'ownership': {'owner': owners, 'renter': renters, 'other': n - owners - renters},

        # ── Residency & Housing (R1–R8) ───────────────────────────────────────
        'residency': {
            'years_in_hre': {
                'n_valid':     yrs_n,
                'mean':        yrs_mean,
                'median':      round(float(yrs_median), 1),
                'distribution': dict(yrs_bins),
            },
            'anticipated_stay': _bin_counts('anticipated_stay'),
            'mh_skirting':      _bin_counts('mh_skirting'),
            'reloc_factors':    {f: _bin_counts(f) for f in RELOC_FIELDS},
        },
        'housing_safety': {
            'env':    _bin_counts('safety_env'),
            'social': _bin_counts('safety_social'),
        },
        'affordability': {
            'urgency':  _bin_counts('afford_urgency'),
            'strategy': _bin_counts('afford_strategy'),
        },

        # ── Community Living (C1, C2) ─────────────────────────────────────────
        'interventions': {
            'pct_want':    {f: _pct_want(f) for f in INTERVENTION_FIELDS},
            'highlights':  list(INTERVENTION_HIGHLIGHTS),
            'order':       list(INTERVENTION_FIELDS),
        },
        'experiences': {
            'pct_yes':     {f: _pct_yes(f) for f in EXPERIENCE_FIELDS},
            'highlights':  list(EXPERIENCE_HIGHLIGHTS),
            'order':       list(EXPERIENCE_FIELDS),
        },

        # ── Well-being & Mobility (W1, W2) ────────────────────────────────────
        'mobility': {
            'car_access':          _yes_no_counts('car_access'),
            'hurricane_transport': _yes_no_counts('hurricane_transport'),
        },

        # ── Demographics+ (D1, D2) ────────────────────────────────────────────
        'demographics_ext': {
            'education':  _bin_counts('education'),
            'employment': _bin_counts('employment'),
        },

        # ── Question-text + chart-source provenance for the dashboard ────────
        'survey_questions': {
            **{f: meta[-1] for f, meta in SURVEY_QUESTIONS.items()},
            **IAQ_FEATURE_POPUP_LABELS,
        },
        'chart_sources':    dict(CHART_SOURCES),
    }


def _compute_street_stats(features):
    """
    Per-street aggregates for LLM context.
    Streets with <3 responses: only count returned (privacy protection).
    """
    grouped = defaultdict(list)
    for f in features:
        grouped[f['properties']['street_name']].append(f['properties'])

    stats = {}
    ranked = []

    for street, props in grouped.items():
        n = len(props)
        if n < 3:
            stats[street] = {'n': n, 'insufficient_data': True}
            continue

        def _m(field):
            vals = [p[field] for p in props if isinstance(p.get(field), (int, float))]
            return round(sum(vals) / len(vals), 1) if vals else 0

        def _pct_active(field):
            active = ('weekly', 'month', 'season')
            return round(
                sum(1 for p in props
                    if any(kw in str(p.get(field, '') or '').lower() for kw in active))
                / n * 100, 1)

        htypes = defaultdict(int)
        for p in props:
            ht = str(p.get('housing_type', '') or '').lower()
            if 'single wide' in ht:
                htypes['single_wide'] += 1
            elif 'double wide' in ht:
                htypes['double_wide'] += 1
            elif 'site' in ht:
                htypes['site_built'] += 1
            else:
                htypes['other'] += 1

        mean_risk = _m('overall_risk')
        entry = {
            'n':             n,
            'mean_risk':     mean_risk,
            'mean_health':   _m('health_score'),
            'mean_iaq':      _m('iaq_score'),
            'mean_struct':   _m('struct_score'),
            'pct_mold':      round(sum(1 for p in props if p.get('has_mold')) / n * 100, 1),
            'pct_respiratory': _pct_active('respiratory_ill'),
            'pct_asthma':    _pct_active('asthma_freq'),
            'pct_hospital':  round(
                sum(1 for p in props if p.get('hospital_visit') == 'yes') / n * 100, 1),
            'housing_types': dict(htypes),
            'owner_count':   sum(1 for p in props if p.get('ownership') == 'Owner'),
            'renter_count':  sum(1 for p in props if p.get('ownership') == 'Renter'),
        }
        stats[street] = entry
        ranked.append((street, mean_risk))

    ranked.sort(key=lambda x: -x[1])
    for rank, (street, _) in enumerate(ranked, 1):
        stats[street]['risk_rank'] = rank

    return stats


def _cross_validate(iaq_features):
    """
    Match IAQ survey points to community contact 'Completed' entries via GPS proximity (≤150 m).
    Returns summary stats + per-response match details with reasons.
    """
    if not survey_data or not survey_data.get('features'):
        return {'status': 'contact_data_not_loaded', 'match_details': []}

    completed = [f for f in survey_data['features']
                 if f['properties'].get('status') == 'Completed']

    matched = 0
    match_details = []

    for iaq_f in iaq_features:
        iaq_lon, iaq_lat = iaq_f['geometry']['coordinates']
        p = iaq_f['properties']

        # Find nearest completed contact
        best_dist = float('inf')
        best_addr = None
        for cf in completed:
            c_lon, c_lat = cf['geometry']['coordinates']
            d = _haversine_m(iaq_lat, iaq_lon, c_lat, c_lon)
            if d < best_dist:
                best_dist = d
                best_addr = cf['properties'].get('address', '')

        is_matched = best_dist <= 150
        if is_matched:
            matched += 1

        coord_src = p.get('coord_source', 'unknown')
        if not is_matched:
            if best_dist < 300:
                reason = f"Nearest contact {round(best_dist)}m away (threshold 150m) — GPS/geocoding offset"
            elif best_dist < 1000:
                reason = f"Nearest contact {round(best_dist)}m away — address may not be in canvassing list"
            else:
                reason = "No nearby contact found — respondent may not be in the contact database"
            if coord_src == 'geocoded':
                reason += "; address was geocoded (less precise than GPS)"
        else:
            reason = f"Matched — {round(best_dist)}m from '{best_addr}'"

        match_details.append({
            'street_name':     p.get('street_name', 'Unknown'),
            'overall_risk':    p.get('overall_risk', 0),
            'coord_source':    coord_src,
            'matched':         is_matched,
            'nearest_contact_m': round(best_dist) if best_dist < float('inf') else None,
            'nearest_contact_addr': best_addr,
            'reason':          reason,
        })

    n_iaq = len(iaq_features)
    n_completed = len(completed)

    # Group unmatched by street for the report
    unmatched_by_street = defaultdict(list)
    for d in match_details:
        if not d['matched']:
            unmatched_by_street[d['street_name']].append(d)

    return {
        'total_iaq_responses':      n_iaq,
        'total_completed_contacts': n_completed,
        'matched_iaq_responses':    matched,
        'unmatched_iaq':            n_iaq - matched,
        'match_rate_pct':           round(matched / max(n_iaq, 1) * 100, 1),
        'coverage_pct':             round(matched / max(n_completed, 1) * 100, 1),
        'match_details':            match_details,
        'unmatched_by_street':      {s: len(v) for s, v in sorted(unmatched_by_street.items(), key=lambda x: -len(x[1]))},
    }


def build_llm_context():
    """Compact JSON context for LLM. match_details excluded to save tokens."""
    if not iaq_analysis or not street_stats:
        return '{}'
    a = iaq_analysis

    ranked = sorted(
        [(s, d) for s, d in street_stats.items() if not d.get('insufficient_data')],
        key=lambda x: -x[1]['mean_risk']
    )  # all streets ordered worst→best (risk_rank 1 = first = worst; last = best)

    # Strip match_details — large per-response array not needed for chat
    validation_summary = {k: v for k, v in iaq_validation.items() if k != 'match_details'}

    # Explicit pointers so LLM never confuses best vs worst
    worst_street = ranked[0][0]  if ranked else None
    best_street  = ranked[-1][0] if ranked else None

    return json.dumps({
        'dataset': {
            'n_surveyed': a.get('n_responses', 0),
            'geocoded':   a.get('geocoded', 0),
            'n_streets_analyzed': len(ranked),
        },
        # ⚡ Key pointers — use these directly for best/worst questions
        'worst_street': worst_street,   # risk_rank=1, highest mean_risk
        'best_street':  best_street,    # last in list, LOWEST mean_risk = safest
        'overview': {
            'mean_risk':               a['scores']['mean_risk'],
            'mean_health':             a['scores']['mean_health'],
            'mean_iaq':                a['scores']['mean_iaq'],
            'risk_tiers_n':            a['risk_tiers'],
            'pct_mold':                a['health']['mold_pct'],
            'pct_respiratory_active':  a['health']['respiratory_pct'],
            'pct_asthma_active':       a['health']['asthma_pct'],
            'pct_hospital':            a['health']['hospital_pct'],
            'owner_pct':  round(a['ownership']['owner'] / max(a['n_responses'], 1) * 100, 1),
            'renter_pct': round(a['ownership']['renter'] / max(a['n_responses'], 1) * 100, 1),
            'housing_types': a['housing']['types'],
            'conditions':    a['housing']['conditions'],
            'year_built':    a['housing']['year_built'],
        },
        # Top 15 worst + bottom 5 best streets only — trims LLM context by
        # ~60% so we get ~10× more queries/day before hitting Groq's TPD limit.
        # Includes all extreme values the LLM needs for ranking questions.
        'streets_by_risk': {s: d for s, d in (ranked[:15] + ranked[-5:])},
        'validation': {k: v for k, v in validation_summary.items()
                       if k in ('match_rate_pct', 'matched_iaq_responses', 'total_iaq_responses')},
        'contact_survey': build_contact_context(),
    }, separators=(',', ':'))


def build_contact_context():
    """Compact contact survey stats for LLM."""
    if not survey_data or not survey_data.get('features'):
        return {}
    from collections import defaultdict
    status_counts = defaultdict(int)
    street_counts = defaultdict(lambda: defaultdict(int))
    for f in survey_data['features']:
        p = f['properties']
        s = p.get('status', 'Unknown')
        sn = p.get('street_name', 'Unknown')
        status_counts[s] += 1
        street_counts[sn][s] += 1
    n_total = sum(status_counts.values())
    top_streets = sorted(
        [(sn, dict(d)) for sn, d in street_counts.items()],
        key=lambda x: -sum(x[1].values())
    )[:8]
    return {
        'total_visits': n_total,
        'by_status': dict(status_counts),
        'completion_rate_pct': round(status_counts.get('Completed', 0) / max(n_total, 1) * 100, 1),
        'top_streets': {sn: d for sn, d in top_streets},
    }


def infer_actions_from_query(query: str) -> list:
    """
    Deterministic fallback: match the user's question against known streets and
    common intent phrases, return map_actions directly. Used when the LLM fails
    to emit a `json_actions` block. Guarantees the map updates for predictable
    queries even if the 8B model is uncooperative.
    """
    if not query or not street_stats:
        return []

    q = query.lower()
    actions = []

    # ── Detect intent keywords ────────────────────────────────────────────────
    show_words  = ('show', 'highlight', 'where', 'find', 'display', 'mark',
                   'see', 'locate', 'point', 'info', 'data', 'for the',
                   'on the map', 'on map')
    worst_words = ('worst', 'highest', 'most', 'top', 'dangerous')
    best_words  = ('best', 'safest', 'lowest', 'least')
    reset_words = ('reset', 'clear', 'remove filter', 'all streets', 'show all')

    # ── Color based on query context ──────────────────────────────────────────
    color = '#3b82f6'  # neutral blue
    if any(w in q for w in worst_words):
        color = '#ef4444'
    elif any(w in q for w in best_words):
        color = '#10b981'
    if 'mold' in q or 'iaq' in q:
        color = '#8b5cf6'
    elif 'struct' in q or 'age' in q or 'old' in q or 'year built' in q:
        color = '#f97316'
    elif 'health' in q or 'asthma' in q or 'respiratory' in q:
        color = '#ef4444'

    # ── Street-name detection: match against known streets ────────────────────
    known_streets = [s for s, d in street_stats.items() if not d.get('insufficient_data')]
    matched_streets = []
    for street in known_streets:
        s_lower = street.lower()
        first_word = street.split()[0].lower()
        # Full-name match OR first-word match (guard against 3-letter false positives)
        if s_lower in q or (len(first_word) >= 4 and re.search(rf'\b{re.escape(first_word)}\b', q)):
            matched_streets.append(street)

    # ── Rank pointers: "worst street" / "best street" / etc. ──────────────────
    ranked = sorted(
        [(s, d) for s, d in street_stats.items() if not d.get('insufficient_data')],
        key=lambda x: -x[1]['mean_risk']
    )
    if not matched_streets and ranked:
        if any(w in q for w in worst_words) and 'street' in q:
            matched_streets = [ranked[0][0]]
        elif any(w in q for w in best_words) and 'street' in q:
            matched_streets = [ranked[-1][0]]

    # ── Build actions based on what was matched ───────────────────────────────
    if matched_streets:
        actions.append({"type": "highlight_streets",
                        "params": {"streets": matched_streets, "color": color}})
        actions.append({"type": "zoom_to_street",
                        "params": {"street": matched_streets[0]}})
        return actions

    # Filter by mold
    if 'mold' in q and any(w in q for w in show_words + ('with', 'houses', 'homes')):
        return [{"type": "filter_iaq_symptom", "params": {"field": "has_mold", "values": [True]}}]

    # Choropleth
    if 'choropleth' in q or 'heatmap of risk' in q or 'risk map' in q:
        field = 'overall_risk'
        if 'health' in q:       field = 'health_score'
        elif 'iaq' in q:        field = 'iaq_score'
        elif 'struct' in q:     field = 'struct_score'
        return [{"type": "show_iaq_choropleth", "params": {"field": field}}]

    # Contact-status filter
    if 'completed' in q and 'surveys' in q:
        return [{"type": "filter_contact_status", "params": {"statuses": ["Completed"]}}]
    if 'no answer' in q:
        return [{"type": "filter_contact_status", "params": {"statuses": ["No Answer"]}}]
    if 'vacant' in q:
        return [{"type": "filter_contact_status", "params": {"statuses": ["Vacant"]}}]

    # Symptom filters
    if 'asthma' in q and any(w in q for w in show_words):
        return [{"type": "filter_iaq_symptom", "params": {"field": "asthma_freq",
                 "values": ["weekly", "month", "season"]}}]
    if 'respiratory' in q and any(w in q for w in show_words):
        return [{"type": "filter_iaq_symptom", "params": {"field": "respiratory_ill",
                 "values": ["weekly", "month", "season"]}}]

    # Reset
    if any(w in q for w in reset_words):
        return [{"type": "clear_filters", "params": {}}]

    return []


# ── Original data processing ───────────────────────────────────────────────────

def process_survey(survey_file_path=None):
    """Geocode survey addresses from the given file path.
    Never reads or writes cache — data stays in memory only."""
    file_to_read = Path(survey_file_path) if survey_file_path else SURVEY_FILE
    suf = file_to_read.suffix.lower()

    log.info(f"Geocoding survey addresses from {file_to_read.name}...")
    df = pd.read_csv(file_to_read) if suf == ".csv" else pd.read_excel(file_to_read)
    features, fails = [], []

    for i, row in df.iterrows():
        addr = str(row["Address"]).strip()
        detail = str(row["First attempt"]) if pd.notna(row.get("First attempt")) else ""
        status = categorize(detail)
        second = str(row.get("Second attempt", "")) if pd.notna(row.get("Second attempt")) else ""
        notes = str(row.get("Other notes: ", "")) if pd.notna(row.get("Other notes: ")) else ""
        dt = ""
        if pd.notna(row.get("date")):
            try:
                dt = str(row["date"].date())
            except Exception:
                dt = str(row["date"])

        street = _extract_street_name(addr) or addr
        log.info(f"  [{i + 1}/{len(df)}] {addr}")
        lng, lat, matched, geo_src = _parcel_geocode(addr)
        if geo_src in ('geocoded', 'parcel_snapped'):
            time.sleep(0.25)   # rate-limit Census API; parcel matches need no sleep

        if lng and lat:
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lng, 6), round(lat, 6)]},
                "properties": {
                    "id": int(i), "address": addr, "status": status,
                    "status_detail": detail, "second_attempt": second,
                    "date": dt, "notes": notes, "street_name": street,
                    "matched_address": matched or "",
                    "coord_source": geo_src,
                    "color": STATUS.get(status, "#9ca3af"),
                },
            })
        else:
            fails.append(addr)

    gj = {"type": "FeatureCollection", "features": features}
    log.info(f"Geocoded {len(features)}/{len(df)} ({len(fails)} failed) — kept in memory only")
    return gj


def process_parcels():
    if CACHE_PAR.exists():
        log.info("Parcels: loaded from cache")
        return json.loads(CACHE_PAR.read_text())

    if not GDB_FILE.exists():
        log.warning("Parcels GDB not found - skipping")
        empty = {"type": "FeatureCollection", "features": []}
        CACHE_PAR.write_text(json.dumps(empty))
        return empty

    log.info("Extracting Keystone Heights parcels (~60 s)...")
    gdf = gpd.read_file(str(GDB_FILE), layer="CADASTRAL_DOR",
                        where="PHY_CITY = 'KEYSTONE HEIGHTS'")
    log.info(f"  Read {len(gdf)} parcels")

    gdf = gdf.to_crs(epsg=4326)
    gdf.geometry = gdf.geometry.map(shapely.force_2d)
    gdf.geometry = gdf.geometry.simplify(0.00005, preserve_topology=True)

    keep = {
        "PARCEL_ID": "parcel_id", "PHY_ADDR1": "address", "OWN_NAME": "owner",
        "DOR_UC": "use_code", "JV": "just_value", "AV_SD": "assessed_value",
        "LND_VAL": "land_value", "TOT_LVG_AR": "living_area",
        "EFF_YR_BLT": "year_built", "ACT_YR_BLT": "actual_year_built",
        "NO_BULDNG": "num_buildings", "NO_RES_UNT": "res_units",
        "SALE_PRC1": "last_sale_price", "SALE_YR1": "last_sale_year",
        "LND_SQFOOT": "lot_sqft", "S_LEGAL": "legal_desc",
    }
    avail = {k: v for k, v in keep.items() if k in gdf.columns}
    gdf = gdf[list(avail.keys()) + ["geometry"]].rename(columns=avail)

    if "use_code" in gdf.columns:
        gdf["land_use"] = gdf["use_code"].apply(classify_land_use)

    nums = ["just_value", "assessed_value", "land_value", "living_area",
            "year_built", "actual_year_built", "num_buildings", "res_units",
            "last_sale_price", "last_sale_year", "lot_sqft"]
    for c in nums:
        if c in gdf.columns:
            gdf[c] = pd.to_numeric(gdf[c], errors="coerce")

    gdf = gdf.where(gdf.notna(), None)
    txt = gdf.to_json()
    CACHE_PAR.write_text(txt)
    log.info(f"Parcels processed: {len(gdf)} ({len(txt) / 1048576:.1f} MB)")
    return json.loads(txt)


def compute_analysis(pts, par):
    feats = pts.get("features", [])
    parcels = par.get("features", [])

    sc = {}
    for f in feats:
        s = f["properties"]["status"]
        sc[s] = sc.get(s, 0) + 1

    st_count, st_status = {}, {}
    for f in feats:
        sn = f["properties"]["street_name"]
        s = f["properties"]["status"]
        st_count[sn] = st_count.get(sn, 0) + 1
        st_status.setdefault(sn, {})[s] = st_status.get(sn, {}).get(s, 0) + 1

    streets = sorted(st_count.items(), key=lambda x: -x[1])
    total = len(feats)
    comp = sc.get("Completed", 0)
    rate = round(comp / total * 100, 1) if total else 0

    ps = {}
    if parcels:
        vals = [p["properties"].get("just_value") for p in parcels
                if p["properties"].get("just_value") and p["properties"]["just_value"] > 0]
        areas = [p["properties"].get("living_area") for p in parcels
                 if p["properties"].get("living_area") and p["properties"]["living_area"] > 0]
        yrs = [p["properties"].get("year_built") for p in parcels
               if p["properties"].get("year_built") and p["properties"]["year_built"] > 1800]
        lu = {}
        for p in parcels:
            g = p["properties"].get("land_use", "Other")
            lu[g] = lu.get(g, 0) + 1

        def stats(arr):
            if not arr:
                return {"mean": 0, "median": 0, "min": 0, "max": 0}
            s = sorted(arr)
            return {"mean": round(sum(s) / len(s)), "median": round(s[len(s) // 2]),
                    "min": round(min(s)), "max": round(max(s))}

        val_bins = []
        if vals:
            import numpy as np
            edges = [0, 25000, 50000, 75000, 100000, 150000, 200000, 300000, 500000, float("inf")]
            labels = ["<25k", "25-50k", "50-75k", "75-100k", "100-150k",
                      "150-200k", "200-300k", "300-500k", "500k+"]
            for j in range(len(edges) - 1):
                cnt = sum(1 for v in vals if edges[j] <= v < edges[j + 1])
                val_bins.append({"label": labels[j], "count": cnt})

        yr_bins = []
        if yrs:
            decades = list(range(1900, 2040, 10))
            for j in range(len(decades) - 1):
                cnt = sum(1 for y in yrs if decades[j] <= y < decades[j + 1])
                yr_bins.append({"label": f"{decades[j]}s", "count": cnt})

        ps = {
            "total": len(parcels), "land_use": lu,
            "values": stats(vals), "areas": stats(areas),
            "years": {"mean": round(sum(yrs) / len(yrs)) if yrs else 0,
                      "oldest": min(yrs) if yrs else 0, "newest": max(yrs) if yrs else 0},
            "value_histogram": val_bins, "year_histogram": yr_bins,
        }

    return {
        "total_points": total, "completion_rate": rate,
        "status_counts": sc, "status_colors": STATUS,
        "streets": [{"name": n, "count": c, "statuses": st_status.get(n, {})}
                    for n, c in streets],
        "parcel_stats": ps,
    }


# ── FastAPI app ────────────────────────────────────────────────────────────────
survey_data:     dict = {}
parcels_data:    dict = {}
analysis:        dict = {}
survey_results:  dict = {}
iaq_data:        dict = {}
iaq_analysis:    dict = {}
street_stats:    dict = {}
iaq_validation:  dict = {}

# ── Parcel spatial index (built once at startup) ───────────────────────────────
_parcel_addr_idx:   dict = {}   # (house_num, street_core) → (lon, lat)
_parcel_by_house:   dict = {}   # house_num → [(street_core, lon, lat)]
_parcel_strtree          = None  # STRtree for spatial snap
_parcel_geoms_list: list = []    # [(geometry, lon, lat)] — parallel to strtree


def _sb_save(data_type: str, payload: dict) -> None:
    """Upsert processed GeoJSON/analysis into Supabase for cross-restart persistence."""
    if not sb:
        return
    try:
        sb.table('keystone_dashboard_data').upsert(
            {'data_type': data_type, 'payload': payload}
        ).execute()
        n = len(payload.get('features', [])) if 'features' in payload else len(payload.get('geojson', {}).get('features', []))
        log.info(f"Supabase: saved {data_type} ({n} features)")
    except Exception as e:
        log.warning(f"Supabase save {data_type}: {e}")


def _sb_load(data_type: str) -> dict | None:
    """Fetch persisted dashboard data from Supabase. Returns None if absent."""
    if not sb:
        return None
    try:
        r = sb.table('keystone_dashboard_data').select('payload').eq('data_type', data_type).execute()
        return r.data[0]['payload'] if r.data else None
    except Exception as e:
        log.warning(f"Supabase load {data_type}: {e}")
        return None


def _sb_save_version(data_type: str, payload: dict, label: str, n_points: int = 0) -> int | None:
    """Append a named snapshot to the versions history table. Returns new row id."""
    if not sb:
        return None
    try:
        r = sb.table('keystone_analysis_versions').insert({
            'data_type': data_type,
            'payload': payload,
            'label': label,
            'n_points': n_points,
        }).execute()
        return r.data[0]['id'] if r.data else None
    except Exception as e:
        log.warning(f"Supabase save_version {data_type}: {e}")
        return None


def _sb_cleanup_chat() -> int:
    """Delete team_chat_messages rows older than today (UTC). Returns count deleted or -1 on error."""
    if not sb:
        return 0
    try:
        today_utc = _datetime.now(_tz.utc).date().isoformat() + 'T00:00:00+00:00'
        r = sb.table('team_chat_messages').delete().lt('sent_at', today_utc).execute()
        n = len(r.data) if r.data else 0
        log.info(f"Chat cleanup: removed {n} stale message(s)")
        return n
    except Exception as e:
        log.warning(f"Chat cleanup failed: {e}")
        return -1


def _sb_list_versions(data_type: str) -> list:
    """List version snapshots newest-first, without payload (lightweight)."""
    if not sb:
        return []
    try:
        r = (sb.table('keystone_analysis_versions')
             .select('id,label,n_points,created_at')
             .eq('data_type', data_type)
             .order('created_at', desc=True)
             .limit(30)
             .execute())
        return r.data or []
    except Exception as e:
        log.warning(f"Supabase list_versions {data_type}: {e}")
        return []


def _sb_load_version_by_id(version_id: int) -> dict | None:
    """Fetch a single version's full payload."""
    if not sb:
        return None
    try:
        r = (sb.table('keystone_analysis_versions')
             .select('id,label,created_at,data_type,payload')
             .eq('id', version_id)
             .execute())
        return r.data[0] if r.data else None
    except Exception as e:
        log.warning(f"Supabase load_version {version_id}: {e}")
        return None


def _field_pts_to_geojson_features(rows: list) -> list:
    """Convert field_survey_points DB rows to GeoJSON features for merging."""
    features = []
    for r in rows:
        lat_v, lon_v = r.get('lat'), r.get('lon')
        if lat_v is None or lon_v is None:
            continue
        lat_f, lon_f = float(lat_v), float(lon_v)
        status = r.get('status', 'Unknown')
        dt_str = (r.get('collected_at') or '')[:10]
        snapped = _snap_to_parcel(lon_f, lat_f, max_dist_m=80)
        if snapped:
            lon_f, lat_f = snapped
        features.append({
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': [round(lon_f, 6), round(lat_f, 6)]},
            'properties': {
                'id': str(r.get('id', '')),
                'address': f"Field Visit — {dt_str}",
                'status': status,
                'status_detail': r.get('notes', ''),
                'second_attempt': '',
                'date': dt_str,
                'notes': r.get('notes', ''),
                'street_name': _extract_street_name(r.get('notes', '')) or 'Field Survey',
                'matched_address': '',
                'coord_source': 'gps_snapped' if snapped else 'gps',
                'color': STATUS.get(status, '#9ca3af'),
                'collector': r.get('collector_name', ''),
                'is_field_point': True,
            }
        })
    return features


@asynccontextmanager
async def lifespan(application):
    global survey_data, parcels_data, analysis, iaq_data, iaq_analysis, street_stats, iaq_validation
    log.info("=" * 50)
    log.info("  KeyStone Field Survey Dashboard")
    log.info("=" * 50)

    # Wipe any stale disk files (sensitive data must not persist on the server filesystem)
    for stale in [CACHE_PTS, CACHE_IAQ, CACHE_RES]:
        if stale.exists():
            try:
                stale.unlink()
                log.info(f"Privacy cleanup: removed {stale.name}")
            except Exception as e:
                log.warning(f"Could not remove {stale.name}: {e}")
    for tmp in OUT.glob("uploaded_*"):
        try:
            tmp.unlink()
        except Exception:
            pass

    # Load parcels (cached GeoJSON or fresh from GDB)
    parcels_data = process_parcels()
    # Build parcel spatial index in a thread (10–30 K geometries, ~2–10 s)
    await asyncio.to_thread(_build_parcel_index, parcels_data)

    # Try to restore survey & IAQ data from Supabase (persists across restarts)
    survey_data = {"type": "FeatureCollection", "features": []}
    contact_stored = await asyncio.to_thread(_sb_load, 'community_contact')
    if contact_stored and contact_stored.get('features'):
        survey_data = contact_stored
        log.info(f"Restored {len(survey_data['features'])} contact points from Supabase")
    elif SURVEY_FILE.exists():
        # First-ever run: auto-geocode the local Excel using parcel-based method
        log.info(f"Auto-processing {SURVEY_FILE.name} with parcel geocoding (first run)...")
        loop = asyncio.get_event_loop()
        survey_data = await loop.run_in_executor(None, process_survey, SURVEY_FILE)
        try: survey_data['source_filename'] = SURVEY_FILE.name
        except Exception: pass
        n = len(survey_data.get('features', []))
        label = f"Initial Analysis — {n} contacts · {SURVEY_FILE.name}"
        # Tag match_status so the desktop dashboard's stroke encoding
        # works from first load — Completed contacts start as G2
        # (contact_only) until an IAQ upload promotes them to G1.
        # Then dedup at parcel rep-point so multiple CSV rows for the
        # same household collapse to a single dot.
        feats = survey_data.get('features', [])
        tag_contact_match_status(feats)
        feats = dedup_contacts_at_parcel(feats)
        survey_data['features'] = feats
        n = len(feats)
        await asyncio.to_thread(_sb_save, 'community_contact', survey_data)
        await asyncio.to_thread(_sb_save_version, 'community_contact', survey_data, label, n)
        log.info(f"Auto-processed and saved {n} contact points to Supabase as '{label}'")
    else:
        log.info("Community contact data: not found — upload required")

    iaq_stored = await asyncio.to_thread(_sb_load, 'iaq_survey')
    if iaq_stored:
        iaq_data       = iaq_stored.get('geojson', {})
        iaq_analysis   = iaq_stored.get('analysis', {})
        street_stats   = iaq_stored.get('street_stats', {})
        iaq_validation = iaq_stored.get('validation', {})
        log.info(f"Restored {len(iaq_data.get('features', []))} IAQ points from Supabase")
    elif IAQ_FILE.exists():
        log.info(f"Auto-processing IAQ CSV: {IAQ_FILE.name}...")
        try:
            loop = asyncio.get_event_loop()
            csv_bytes = IAQ_FILE.read_bytes()
            result = await loop.run_in_executor(None, process_iaq_survey, csv_bytes)
            iaq_data, iaq_analysis, street_stats, iaq_validation = result
            # Strip raw_address (used for matching only — must not be persisted)
            for _f in iaq_data.get('features', []):
                _f['properties'].pop('raw_address', None)
            n = len(iaq_data.get('features', []))
            iaq_payload = {
                'geojson': iaq_data, 'analysis': iaq_analysis,
                'street_stats': street_stats, 'validation': iaq_validation,
                'source_filename': IAQ_FILE.name,
            }
            label = f"Initial IAQ Analysis — {n} responses · {IAQ_FILE.name}"
            await asyncio.to_thread(_sb_save, 'iaq_survey', iaq_payload)
            await asyncio.to_thread(_sb_save_version, 'iaq_survey', iaq_payload, label, n)
            log.info(f"Auto-processed and saved {n} IAQ points as '{label}'")
        except Exception as e:
            log.warning(f"Auto IAQ processing failed: {e}")
    else:
        log.info("IAQ survey data: not in Supabase — upload required")

    # ── One-time migration: apply IAQ↔Contact matching to existing Supabase data ──
    # If both datasets are loaded and no contact has been tagged with has_iaq_survey
    # yet, this is either a fresh first-run or an older deployment that didn't have
    # the merge logic.  Run the match now so the dashboard immediately shows the
    # correct "Completed" statuses without requiring a manual re-upload.
    if (survey_data.get('features') and iaq_data.get('features') and
            not any(f['properties'].get('has_iaq_survey')
                    for f in survey_data.get('features', []))):
        log.info("Startup: running IAQ↔Contact migration for existing data...")
        try:
            _contact_feats = list(survey_data['features'])
            _matches = _match_iaq_to_contacts(iaq_data['features'], _contact_feats)
            _n_up = _upgrade_contacts_from_iaq(_contact_feats, iaq_data['features'], _matches)
            if _n_up:
                # Re-tag match_status on every contact (B1 fix): without
                # this, contacts that just got has_iaq_survey=true keep
                # their stale match_status='contact_only', so the cached
                # blob renders as G2 yellow rim despite the popup showing
                # "Qualtric matched". Same for the IAQ side — flag the
                # newly-matched IAQ features as 'matched'.
                tag_contact_match_status(_contact_feats)
                _contact_feats = dedup_contacts_at_parcel(_contact_feats)
                for _f in iaq_data.get('features', []):
                    _f['properties']['match_status'] = (
                        'matched' if _f['properties'].get('iaq_matched') else 'iaq_only'
                    )
                survey_data['features'] = _contact_feats
                # Re-save IAQ data with iaq_matched flags set
                _iaq_payload_updated = {
                    'geojson': iaq_data,
                    'analysis': iaq_analysis,
                    'street_stats': street_stats,
                    'validation': iaq_validation,
                }
                await asyncio.to_thread(_sb_save, 'community_contact', survey_data)
                await asyncio.to_thread(_sb_save, 'iaq_survey', _iaq_payload_updated)
                log.info(f"Startup migration complete: {_n_up} contacts upgraded to Completed")
        except Exception as e:
            log.warning(f"Startup IAQ migration failed (non-fatal): {e}")

    analysis = compute_analysis(survey_data, parcels_data)

    # Persist analysis + parcels blobs to Supabase so the Vercel dashboard
    # can read them without re-running this pipeline.
    try:
        if analysis:
            _sb_save('analysis', analysis)
        if parcels_data and parcels_data.get('features'):
            _sb_save('parcels', parcels_data)
        log.info("Persisted analysis + parcels blobs to Supabase.")
    except Exception as e:
        log.warning(f"Could not persist analysis/parcels blobs: {e}")

    log.info("-" * 50)
    log.info("  Ready! Open http://localhost:8050")
    log.info("-" * 50)
    yield


app = FastAPI(title="KeyStone Survey Dashboard", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Standard endpoints ─────────────────────────────────────────────────────────

@app.get("/")
async def root():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/field/login.html", status_code=302)


@app.get("/dashboard")
async def dashboard():
    return FileResponse(STATIC / "index.html")


@app.get("/api/config")
async def api_config():
    """Public client config (Supabase URL + anon key). Safe to expose; RLS guards writes."""
    return JSONResponse({
        "supabase_url": os.environ.get("SUPABASE_URL", ""),
        "supabase_anon_key": os.environ.get("SUPABASE_ANON_KEY", ""),
    })


@app.get("/api/survey-points")
async def api_pts():
    return JSONResponse(survey_data or {"type": "FeatureCollection", "features": []})


@app.get("/api/parcels")
async def api_par():
    return JSONResponse(parcels_data or {"type": "FeatureCollection", "features": []})


@app.get("/api/analysis")
async def api_analysis():
    return JSONResponse(analysis or {})


@app.get("/api/survey-results")
async def api_results():
    if not survey_results:
        return JSONResponse({"loaded": False})
    return JSONResponse({"loaded": True, "data": survey_results})


# ── IAQ endpoints ──────────────────────────────────────────────────────────────

def _strip_survey_answers_local(geojson):
    """Mirror of api/_lib.strip_survey_answers — drops per-respondent
    SURVEY_QUESTIONS keys from every feature so the public IAQ endpoint
    doesn't leak individuals' answers. Authenticated ``/api/iaq-points?full=1``
    (and legacy ``/api/iaq-points-full``) serves the un-stripped payload."""
    if not isinstance(geojson, dict):
        return geojson
    feats_in = geojson.get('features') or []
    if not isinstance(feats_in, list):
        return geojson
    keys = set(SURVEY_QUESTIONS.keys())
    feats_out = []
    for f in feats_in:
        if not isinstance(f, dict):
            feats_out.append(f); continue
        props = f.get('properties') or {}
        if not isinstance(props, dict):
            feats_out.append(f); continue
        feats_out.append({**f, 'properties': {k: v for k, v in props.items() if k not in keys}})
    return {**geojson, 'features': feats_out}


_iaq_full_anon_sb = None  # lazy-init; uses anon key, NOT the service-role key.

def _check_auth_header_local(request) -> str | None:
    """Verify the request's Supabase Bearer token. Returns the user id on
    success, None otherwise (caller must respond 401)."""
    global _iaq_full_anon_sb
    auth = request.headers.get('authorization') or request.headers.get('Authorization') or ''
    if not auth.lower().startswith('bearer '):
        return None
    jwt = auth.split(' ', 1)[1].strip()
    if not jwt:
        return None
    if _iaq_full_anon_sb is None:
        try:
            url  = os.environ.get('SUPABASE_URL', '')
            anon = os.environ.get('SUPABASE_ANON_KEY', '')
            if not (url and anon):
                return None
            from supabase import create_client as _cc
            _iaq_full_anon_sb = _cc(url, anon)
        except Exception:
            return None
    try:
        resp = _iaq_full_anon_sb.auth.get_user(jwt)
        user = getattr(resp, 'user', None)
        return getattr(user, 'id', None) if user else None
    except Exception:
        return None


def _iaq_wants_full_export(request: Request) -> bool:
    q = (request.query_params.get("full") or "").strip()
    return q.lower() in ("1", "true", "yes")


def _iaq_full_geojson_response(request: Request):
    """Bearer JWT required — full per-respondent answers for dashboard."""
    if _check_auth_header_local(request) is None:
        return JSONResponse({"detail": "Authentication required."}, status_code=401)
    if not iaq_data:
        return JSONResponse({"type": "FeatureCollection", "features": []})
    return JSONResponse(iaq_data)


@app.get("/api/iaq-points")
async def api_iaq_pts(request: Request):
    """Public default: answers stripped. ``?full=1`` + Bearer JWT returns full
    GeoJSON (matches Vercel ``api/iaq-points.py`` — single function on Hobby)."""
    empty = {"type": "FeatureCollection", "features": []}
    if not iaq_data:
        return JSONResponse(empty)
    if _iaq_wants_full_export(request):
        return _iaq_full_geojson_response(request)
    return JSONResponse(_strip_survey_answers_local(iaq_data))


@app.get("/api/iaq-points-full")
async def api_iaq_pts_full(request: Request):
    """Legacy alias — same body as ``/api/iaq-points?full=1``."""
    return _iaq_full_geojson_response(request)


@app.get("/api/iaq-analysis")
async def api_iaq_analysis_ep():
    if not iaq_analysis:
        return JSONResponse({"loaded": False})
    return JSONResponse({
        "loaded": True,
        "analysis": iaq_analysis,
        "street_stats": street_stats,
        "validation": iaq_validation,
    })


@app.get("/api/versions")
async def api_versions():
    """List all analysis version snapshots (newest first, no payload)."""
    contact_v = await asyncio.to_thread(_sb_list_versions, 'community_contact')
    iaq_v     = await asyncio.to_thread(_sb_list_versions, 'iaq_survey')
    return JSONResponse({'community_contact': contact_v, 'iaq_survey': iaq_v})


@app.post("/api/versions/{version_id}/restore")
async def api_restore_version(version_id: int):
    """Load a historical snapshot and make it the active dataset."""
    global survey_data, analysis, iaq_data, iaq_analysis, street_stats, iaq_validation
    v = await asyncio.to_thread(_sb_load_version_by_id, version_id)
    if not v:
        raise HTTPException(404, "Version not found")
    payload = v['payload']
    if 'features' in payload:
        survey_data = payload
        analysis = compute_analysis(survey_data, parcels_data)
        await asyncio.to_thread(_sb_save, 'community_contact', survey_data)
        return JSONResponse({"restored": True, "label": v['label'], "type": "community_contact",
                             "points": len(survey_data.get('features', []))})
    if 'geojson' in payload:
        iaq_data       = payload.get('geojson', {})
        iaq_analysis   = payload.get('analysis', {})
        street_stats   = payload.get('street_stats', {})
        iaq_validation = payload.get('validation', {})
        await asyncio.to_thread(_sb_save, 'iaq_survey', payload)
        return JSONResponse({"restored": True, "label": v['label'], "type": "iaq_survey",
                             "points": len(iaq_data.get('features', []))})
    raise HTTPException(400, "Unknown payload format")


@app.post("/api/daily-refresh")
async def daily_refresh():
    """
    Check for field_survey_points collected since the last analysis snapshot.
    If any exist, merge them into the community contact dataset, re-run analysis,
    and save a new version.  Designed to be called by a daily Supabase cron job.
    """
    global survey_data, analysis
    if not sb:
        return JSONResponse({"refreshed": False, "reason": "Supabase not configured"})

    # Find timestamp of the most recent community_contact snapshot
    versions = await asyncio.to_thread(
        lambda: sb.table('keystone_analysis_versions')
                  .select('created_at')
                  .eq('data_type', 'community_contact')
                  .order('created_at', desc=True)
                  .limit(1)
                  .execute()
    )
    last_at = versions.data[0]['created_at'] if versions.data else '2000-01-01T00:00:00Z'

    # Fetch only field points collected AFTER the last snapshot
    new_pts_result = await asyncio.to_thread(
        lambda: sb.table('field_survey_points')
                  .select('*')
                  .gt('collected_at', last_at)
                  .execute()
    )
    new_rows = new_pts_result.data or []
    if not new_rows:
        return JSONResponse({"refreshed": False,
                             "reason": "No new field data since last analysis",
                             "last_analysis": last_at})

    new_features = _field_pts_to_geojson_features(new_rows)

    # Upgrade any new field point that has a matching IAQ survey within 50 m.
    # This covers the future flow: surveyor records the GPS point → resident later
    # fills the Qualtric survey online → next daily refresh promotes the point.
    if iaq_data and iaq_data.get('features'):
        _apply_iaq_to_field_features(new_features, iaq_data['features'])

    merged = {
        'type': 'FeatureCollection',
        'features': list(survey_data.get('features', [])) + new_features,
    }
    today   = _datetime.now(_tz.utc).date().isoformat()
    n_total = len(merged['features'])
    n_iaq_upgraded = sum(1 for f in new_features if f['properties'].get('has_iaq_survey'))
    label   = (f"Daily Update {today} — {len(new_rows)} new field visits"
               + (f" ({n_iaq_upgraded} Qualtric-matched)" if n_iaq_upgraded else "")
               + f" ({n_total} total)")

    survey_data = merged
    # Daily-refresh appends new field-as-features to the blob. Re-tag
    # the entire merged feature list so newly-added points pick up
    # G1 / G2 strokes consistently with the rest, then dedup at the
    # parcel rep-point so a fresh field point at the same parcel as
    # an existing CSV contact doesn't render as two stacked dots.
    feats = survey_data.get('features', [])
    tag_contact_match_status(feats)
    feats = dedup_contacts_at_parcel(feats)
    survey_data['features'] = feats
    n_total = len(feats)
    analysis    = compute_analysis(survey_data, parcels_data)
    await asyncio.to_thread(_sb_save, 'community_contact', survey_data)
    await asyncio.to_thread(_sb_save_version, 'community_contact', survey_data, label, n_total)
    if analysis:
        await asyncio.to_thread(_sb_save, 'analysis', analysis)
    await asyncio.to_thread(_sb_cleanup_chat)
    log.info(f"Daily refresh: +{len(new_rows)} field points → {n_total} total → '{label}'")
    return JSONResponse({"refreshed": True, "new_field_points": len(new_rows),
                         "total_points": n_total, "label": label})


@app.post("/api/team/chat/cleanup")
async def team_chat_cleanup():
    """Backup cleanup endpoint if pg_cron is not enabled. Deletes prior-day chat messages."""
    n = await asyncio.to_thread(_sb_cleanup_chat)
    return JSONResponse({"cleaned": n})


@app.get("/api/analysis-meta")
async def api_analysis_meta():
    """Return the most-recent snapshot label + date for the header badge."""
    contact_v = await asyncio.to_thread(_sb_list_versions, 'community_contact')
    iaq_v     = await asyncio.to_thread(_sb_list_versions, 'iaq_survey')
    return JSONResponse({
        'contact': contact_v[0] if contact_v else None,
        'iaq':     iaq_v[0]     if iaq_v     else None,
    })


@app.get("/api/community-contacts")
async def api_community_contacts(filter: str = "all"):
    """Return community contact GeoJSON; filter=today limits to today's date entries."""
    features = (survey_data or {}).get('features', [])
    if filter == "today":
        today = _datetime.now(_tz.utc).date().isoformat()
        features = [f for f in features if f.get('properties', {}).get('date', '') == today]
    return JSONResponse({"type": "FeatureCollection", "features": features, "total": len(features)})


@app.post("/api/upload/iaq")
async def upload_iaq(file: UploadFile = File(...)):
    """Upload and process the Keystone Heights Survey Qualtrics CSV (in-memory only)."""
    global survey_data, iaq_data, iaq_analysis, street_stats, iaq_validation

    # Refresh contacts from Supabase before processing so this local instance
    # picks up uploads made through Vercel since startup. Keeps local↔Vercel
    # parity; cost is one extra read per IAQ upload.
    sb_contacts = await asyncio.to_thread(_sb_load, 'community_contact')
    if sb_contacts and sb_contacts.get('features'):
        survey_data = sb_contacts

    # Enforce upload order: community contact data must be loaded first so the
    # IAQ processor can cross-reference geocoded addresses for validation.
    if not survey_data or not survey_data.get("features"):
        raise HTTPException(
            400,
            "Upload the Community Survey Contact Data (Step 1) before uploading the Qualtrics CSV."
        )

    suf = Path(file.filename).suffix.lower()
    if suf not in (".csv",):
        raise HTTPException(400, "Upload a CSV file exported from Qualtrics")

    csv_bytes = await file.read()

    # Three-tier exception split (mirrors api/upload/iaq.py): only application-
    # authored ValueError messages reach the client. Pandas parse errors get a
    # friendly hint. Anything else is logged and surfaced as a generic 500 — we
    # must not echo cell values back to the user before PII stripping completes.
    try:
        iaq_data, iaq_analysis, street_stats, iaq_validation = process_iaq_survey(csv_bytes)
    except (pd.errors.ParserError, pd.errors.EmptyDataError) as e:
        log.warning(f"IAQ pandas parse error: {e}")
        raise HTTPException(400, "Could not parse CSV. Re-export from Qualtrics as CSV (UTF-8).")
    except ValueError as e:
        log.warning(f"IAQ validation: {e}")
        raise HTTPException(400, str(e))
    except Exception:
        log.exception("IAQ processing error")
        raise HTTPException(500, "Processing failed — check server logs.")

    n = len(iaq_data.get("features", []))

    # ── Match IAQ responses to community contacts ─────────────────────────────
    # For every Qualtric response that can be linked to a contact address (by Q212
    # text or by GPS proximity ≤50 m), upgrade the contact status to "Completed"
    # and attach IAQ scores for popup display.  The matched IAQ feature is flagged
    # iaq_matched=True so the frontend hides it from the IAQ layer (it is already
    # shown as the Completed green dot in the contact layer).
    n_upgraded = 0
    contact_feats = list((survey_data or {}).get('features', []))
    if contact_feats and iaq_data.get('features'):
        matches = _match_iaq_to_contacts(iaq_data['features'], contact_feats)
        n_upgraded = _upgrade_contacts_from_iaq(contact_feats, iaq_data['features'], matches)
        # Always retag — even if nothing upgraded, an existing contact
        # might have flipped from G2 → G1 and we want the stroke fresh.
        # Then dedup at parcel rep-point so co-located contacts collapse
        # to a single dot regardless of how many CSV rows they came from.
        # Detect whether tag_contact_match_status mutated anything so a
        # stale 'contact_only' on a now-matched contact gets re-persisted
        # (otherwise the cached blob keeps the wrong rim forever).
        pre_tag = [(cf.get('properties') or {}).get('match_status') for cf in contact_feats]
        tag_contact_match_status(contact_feats)
        post_tag = [(cf.get('properties') or {}).get('match_status') for cf in contact_feats]
        tag_changed = pre_tag != post_tag
        pre_dedup_n = len(contact_feats)
        contact_feats = dedup_contacts_at_parcel(contact_feats)
        dedup_dropped = pre_dedup_n - len(contact_feats)
        if n_upgraded or dedup_dropped or tag_changed:
            survey_data['features'] = contact_feats
            analysis = compute_analysis(survey_data, parcels_data)
            contact_label = (f"IAQ-merged {_datetime.now(_tz.utc).date().isoformat()} — "
                             f"{n_upgraded} contacts upgraded · {file.filename}")
            await asyncio.to_thread(_sb_save, 'community_contact', survey_data)
            await asyncio.to_thread(_sb_save_version, 'community_contact', survey_data,
                                    contact_label, len(contact_feats))
            if analysis:
                await asyncio.to_thread(_sb_save, 'analysis', analysis)

    # Tag every IAQ feature with G1 (matched) or G3 (iaq_only).
    for _f in iaq_data.get('features', []):
        _f['properties']['match_status'] = (
            'matched' if _f['properties'].get('iaq_matched') else 'iaq_only'
        )

    # Strip raw_address before persisting — it was only needed for address matching.
    # Storing full home addresses of respondents contradicts the anonymisation policy
    # and would expose PII to every authenticated dashboard user via Supabase.
    for _f in iaq_data.get('features', []):
        _f['properties'].pop('raw_address', None)

    iaq_payload = {
        'geojson':         iaq_data,
        'analysis':        iaq_analysis,
        'street_stats':    street_stats,
        'validation':      iaq_validation,
        'source_filename': file.filename,
    }
    iaq_label = f"IAQ Upload {_datetime.now(_tz.utc).date().isoformat()} — {n} responses · {file.filename}"
    await asyncio.to_thread(_sb_save, 'iaq_survey', iaq_payload)
    await asyncio.to_thread(_sb_save_version, 'iaq_survey', iaq_payload, iaq_label, n)
    n_streets = len([s for s, d in street_stats.items() if not d.get("insufficient_data")])

    # Upgrade live field_survey_points within 50 m of any IAQ feature so the
    # mobile/desktop dashboards mark them Completed in real time. Mirrors the
    # Vercel iaq.py block so behavior is identical across deployments.
    n_field_upgraded = 0
    iaq_feats_for_field = iaq_data.get('features', [])
    if sb and iaq_feats_for_field:
        # Paginate — PostgREST caps default SELECT at 1000 rows.
        field_rows: list = []
        PAGE = 1000
        HARD_CAP = 100000
        offset = 0
        try:
            while offset < HARD_CAP:
                page_res = await asyncio.to_thread(
                    lambda o=offset: sb.table('field_survey_points')
                                       .select('id, lat, lon, status')
                                       .range(o, o + PAGE - 1)
                                       .execute()
                )
                page = page_res.data or []
                if not page:
                    break
                field_rows.extend(page)
                if len(page) < PAGE:
                    break
                offset += PAGE
            if len(field_rows) >= HARD_CAP:
                log.warning(f"field_survey_points pagination capped at {HARD_CAP}")
        except Exception as e:
            log.warning(f"field_survey_points read failed: {e}")
            field_rows = []

        if field_rows:
            field_feats = [
                {
                    'type': 'Feature',
                    'geometry': {'type': 'Point',
                                 'coordinates': [r['lon'], r['lat']]},
                    'properties': {'field_point_id': r['id'],
                                   'status': r.get('status') or 'Unknown'},
                }
                for r in field_rows
                if r.get('lon') is not None and r.get('lat') is not None
            ]
            n_field_upgraded = _apply_iaq_to_field_features(field_feats, iaq_feats_for_field)
            upgraded_ids = [
                ff['properties']['field_point_id']
                for ff in field_feats
                if (ff['properties'].get('has_iaq_survey')
                    and ff['properties'].get('status') == 'Completed')
            ]
            if upgraded_ids:
                try:
                    await asyncio.to_thread(
                        lambda ids=upgraded_ids:
                            sb.table('field_survey_points')
                              .update({'status': 'Completed'})
                              .in_('id', ids)
                              .execute()
                    )
                except Exception as e:
                    log.warning(f"bulk field-point upgrade failed n={len(upgraded_ids)}: {e}")
            if n_field_upgraded > 0:
                try:
                    await asyncio.to_thread(
                        _sb_save_version, 'field_survey',
                        {'n_field_upgraded': n_field_upgraded},
                        f"IAQ-merged {_datetime.now(_tz.utc).date().isoformat()} — "
                        f"{n_field_upgraded} field points completed · {file.filename}",
                        n_field_upgraded,
                    )
                except Exception as e:
                    log.warning(f"field_survey version insert failed: {e}")

    log.info(f"IAQ data ready: {n} points, {n_streets} streets — "
             f"{n_upgraded} contacts upgraded, {n_field_upgraded} field points upgraded")

    return {
        "status": "ok",
        "points": n,
        "streets_analyzed": n_streets,
        "mean_risk": iaq_analysis.get("scores", {}).get("mean_risk", 0),
        "n_upgraded": n_upgraded,
        "n_field_upgraded": n_field_upgraded,
        "validation": iaq_validation,
    }


# ── Free model chain (provider, model_id, display_name, api_url, supports_tools) ──
_GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions"
_GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"

MODEL_CHAIN = [
    # Provider   Model ID                        Display name         API URL        Tools?
    # Order: highest daily budget first. 8B handles ~333 msgs/day vs 70B's ~33.
    # Text-action protocol (json_actions block) makes 8B fully map-capable without tools.
    ("groq",   "llama-3.1-8b-instant",     "Llama 3.1 8B",     _GROQ_URL,   False), # 1M TPD
    ("groq",   "llama-3.3-70b-versatile",  "Llama 3.3 70B",    _GROQ_URL,   True),  # 100K TPD — quality fallback
    ("gemini", "gemini-2.0-flash",         "Gemini 2.0 Flash", _GEMINI_URL, True),  # broken on AQ.* keys
]

_model_cooldowns: dict = {}        # model_id → unix timestamp when cooldown expires
_model_cooldown_hits: dict = {}    # model_id → consecutive 429 count (for backoff)
_COOLDOWN_BASE = 90                # seconds — recovers after Groq per-minute resets
_COOLDOWN_MAX  = 3600              # cap at 1 hour for repeated daily-limit hits


def _pick_model(env_model: str) -> tuple:
    """Return first non-rate-limited chain entry, respecting GROQ_MODEL env override."""
    now = time.time()
    env_entry = next((m for m in MODEL_CHAIN if m[1] == env_model), None)
    chain = ([env_entry] + [m for m in MODEL_CHAIN if m[1] != env_model]) if env_entry else MODEL_CHAIN
    for entry in chain:
        if now >= _model_cooldowns.get(entry[1], 0):
            return entry
    # All in cooldown — return the one that recovers soonest
    return min(chain, key=lambda m: _model_cooldowns.get(m[1], 0))  # noqa: F841


def _throttle_model(model_id: str, retry_after_sec: float = 0) -> None:
    hits = _model_cooldown_hits.get(model_id, 0) + 1
    _model_cooldown_hits[model_id] = hits
    # Prefer server-provided retry-after (accurate for Groq daily limits).
    # Fall back to exponential backoff: 90s → 180s → 360s → … capped at 1 hour.
    if retry_after_sec > 0:
        secs = min(retry_after_sec + 5, 86400)   # pad 5s, cap 24h for daily limits
    else:
        secs = min(_COOLDOWN_BASE * (2 ** (hits - 1)), _COOLDOWN_MAX)
    expiry = time.time() + secs
    _model_cooldowns[model_id] = expiry
    log.warning(f"Model {model_id} rate-limited (hit #{hits}); cooldown {int(secs)}s until {time.strftime('%H:%M:%S', time.localtime(expiry))}")


# ── Chat endpoint ──────────────────────────────────────────────────────────────

@app.post("/api/chat")
async def api_chat(request: Request):
    global iaq_data, iaq_analysis, street_stats

    body = await request.json()
    message = str(body.get("message", "")).strip()
    map_state = str(body.get("map_state", "unknown"))
    history = body.get("history", [])[-5:]

    if not message:
        raise HTTPException(400, "No message provided")

    if not iaq_data or not iaq_data.get("features"):
        return JSONResponse({
            "text": "No survey data loaded yet. Upload the Keystone Heights Survey CSV "
                    "via the **Import Data** button to enable AI analysis.",
            "map_actions": [], "model_used": None,
        })

    # ── Resolve API keys ───────────────────────────────────────────────────────
    groq_key   = os.environ.get("GROQ_API_KEY", "")
    gemini_key = os.environ.get("GEMINI_API_KEY", "")

    # Build effective chain — drop Gemini if no key, drop Groq if no key
    effective_chain = []
    for entry in MODEL_CHAIN:
        provider, model_id = entry[0], entry[1]
        if provider == "groq"   and not groq_key:   continue
        if provider == "gemini" and not gemini_key: continue
        effective_chain.append(entry)

    if not effective_chain:
        return JSONResponse({
            "text": "AI chatbot is not configured. Set **GROQ_API_KEY** (and optionally "
                    "**GEMINI_API_KEY**) in your environment to enable this feature.",
            "map_actions": [], "model_used": None,
        })

    # ── Build messages ─────────────────────────────────────────────────────────
    context = build_llm_context()
    n_iaq = iaq_analysis.get("n_responses", 0)
    n_contact = len(survey_data.get("features", [])) if survey_data else 0

    base_system = CHAT_SYSTEM_PROMPT.format(
        n_iaq=n_iaq, n_contact=n_contact, map_state=map_state, data=context)

    # Text-fallback protocol: models without tool support (or models whose tool
    # call gets rejected) must emit actions as a JSON code block at the END of
    # their response. Server parses the block and returns it as map_actions.
    TEXT_ACTION_PROTOCOL = """

=== CRITICAL: MAP ACTION OUTPUT ===
ANY response that references a specific street, filter, layer, or view MUST end
with a ```json_actions``` fenced block. NEVER describe actions in prose like
"we need to filter X" — EMIT the action instead. The block is hidden from the
user; your prose is the analysis, the block is the action.

Required format (exact fence tag `json_actions`, NOT `json`):
```json_actions
[{"type":"highlight_streets","params":{"streets":["Harvard Ave"],"color":"#ef4444"}},
 {"type":"zoom_to_street","params":{"street":"Harvard Ave"}}]
```

Examples of user queries and the REQUIRED action block:

Q: "worst street" / "highest risk street" / "show survey points for Harvard Ave"
→ ```json_actions
[{"type":"highlight_streets","params":{"streets":["Harvard Ave"],"color":"#ef4444"}},
 {"type":"zoom_to_street","params":{"street":"Harvard Ave"}}]
```

Q: "show mold cases" / "houses with mold"
→ ```json_actions
[{"type":"filter_iaq_symptom","params":{"field":"has_mold","values":[true]}}]
```

Q: "overall risk choropleth" / "heatmap of risk"
→ ```json_actions
[{"type":"show_iaq_choropleth","params":{"field":"overall_risk"}}]
```

Q: "completed surveys" / "which homes are done"
→ ```json_actions
[{"type":"filter_contact_status","params":{"statuses":["Completed"]}}]
```

Q: "reset" / "clear all"
→ ```json_actions
[{"type":"clear_filters","params":{}}]
```

FORBIDDEN: saying "we need to filter X" or "to do this we would..." or "this
will require the action:" without emitting the block. That leaves the map
unchanged and the user frustrated. Always emit the block when the query
mentions a street/filter/layer — even if you're not 100% sure, ship the most
likely action.
"""

    messages_with_tools = [{"role": "system", "content": base_system}]
    messages_text_only  = [{"role": "system", "content": base_system + TEXT_ACTION_PROTOCOL}]
    for turn in history:
        role = turn.get("role", "")
        content = turn.get("content", "")
        if role in ("user", "assistant") and content:
            messages_with_tools.append({"role": role, "content": str(content)})
            messages_text_only.append({"role": role, "content": str(content)})
    messages_with_tools.append({"role": "user", "content": message})
    messages_text_only.append({"role": "user", "content": message})

    tools = [{
        "type": "function",
        "function": {
            "name": "map_control",
            "description": (
                "Control the map. Call once with an 'actions' array of action objects. "
                "Each action has 'type' (string) and 'params' (object). "
                "Valid action types: set_layer_visibility, highlight_streets, zoom_to_street, "
                "filter_contact_status, filter_iaq_symptom, show_iaq_choropleth, "
                "clear_filters, show_analysis_tab, show_layer, filter_points, show_choropleth, clear_all. "
                "Multiple actions can be combined in one call."
            ),
            "parameters": {
                "type": "object", "required": ["actions"],
                "properties": {
                    "actions": {
                        "type": "array",
                        "items": {
                            "type": "object", "required": ["type", "params"],
                            "properties": {
                                "type":   {"type": "string"},
                                "params": {"type": "object"},
                            },
                        }
                    }
                },
            }
        }
    }]

    env_pref = os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant")

    def _api_key(provider: str) -> str:
        return groq_key if provider == "groq" else gemini_key

    def _call_model(provider, model_id, api_url, with_tools=True):
        payload = {
            "model": model_id,
            "messages": messages_with_tools if with_tools else messages_text_only,
            "max_tokens": 1200,
            "temperature": 0.3,
        }
        if with_tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        return requests.post(
            api_url,
            headers={"Authorization": f"Bearer {_api_key(provider)}",
                     "Content-Type": "application/json"},
            json=payload,
            timeout=30,
        )

    # ── Try each model in chain, skip rate-limited ones ────────────────────────
    resp = None
    used_provider = used_model_id = used_display = used_url = None
    attempted: set = set()

    # Sort chain so env-preferred model is first
    def _chain_order():
        head = [e for e in effective_chain if e[1] == env_pref]
        tail = [e for e in effective_chain if e[1] != env_pref]
        return head + tail

    now = time.time()
    sorted_chain = sorted(
        _chain_order(),
        # Primary: prefer models not in cooldown. Secondary: prefer tool-capable models
        # so Gemini (tools=True) is always tried before llama-3.1-8b / mixtral (tools=False)
        # when both have the same cooldown time (i.e. neither has been rate-limited yet).
        key=lambda e: (_model_cooldowns.get(e[1], 0), 0 if (e[4] if len(e) > 4 else True) else 1)
    )

    for entry in sorted_chain:
        provider, model_id, display_name, api_url = entry[0], entry[1], entry[2], entry[3]
        model_supports_tools = entry[4] if len(entry) > 4 else True

        if model_id in attempted:
            continue
        if _model_cooldowns.get(model_id, 0) > now:
            log.info(f"Skipping {model_id} (still in cooldown)")
            continue
        attempted.add(model_id)
        log.info(f"Trying model: {display_name} ({model_id})")
        try:
            resp = await asyncio.to_thread(
                lambda p=provider, m=model_id, u=api_url: _call_model(p, m, u, with_tools=model_supports_tools)
            )
        except Exception as e:
            log.warning(f"Request to {model_id} failed: {e}")
            continue

        if resp.status_code == 401:
            # Invalid API key — all models on this provider will fail; skip them all
            log.warning(f"{model_id} returned 401 (invalid API key) — skipping all {provider} models")
            for ep, em, *_ in sorted_chain:
                if ep == provider:
                    attempted.add(em)
            continue

        if resp.status_code == 429:
            # Parse Groq's retry-after hint (header or body) so daily-limit 429s
            # don't retry every 90s — wait for the actual reset (often hours).
            retry_after = 0.0
            try:
                retry_after = float(resp.headers.get("retry-after", 0) or 0)
            except (TypeError, ValueError):
                pass
            if not retry_after:
                try:
                    body_err = resp.json().get("error", {})
                    msg = str(body_err.get("message", ""))
                    # Groq message format: "...Please try again in 7m32.5s..."
                    m = re.search(r"in\s+(?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s", msg)
                    if m:
                        h = int(m.group(1) or 0)
                        mm = int(m.group(2) or 0)
                        ss = float(m.group(3) or 0)
                        retry_after = h * 3600 + mm * 60 + ss
                except Exception:
                    pass
            _throttle_model(model_id, retry_after)
            continue   # try next model

        if resp.status_code == 400 and model_supports_tools:
            # Tool-call schema rejection (common with Gemini OpenAI-compat).
            # Log the exact error body, retry without tools; parser will
            # extract any `json_actions` block from the text response.
            log.warning(f"{model_id} 400 body: {resp.text[:500]}")
            log.warning(f"{model_id} tool validation error, retrying without tools")
            try:
                resp = await asyncio.to_thread(
                    lambda p=provider, m=model_id, u=api_url: _call_model(p, m, u, with_tools=False)
                )
                if resp.status_code == 200:
                    used_provider, used_model_id, used_display, used_url = provider, model_id, display_name, api_url
                    _model_cooldown_hits[model_id] = 0
                    break   # fall through to parser which will extract json_actions block
                # No-tools retry also failed → auth/key is broken; cool down 1h so we stop
                # wasting a round-trip on every request.
                log.warning(f"{model_id} no-tools retry also failed ({resp.status_code}); cooling down 1h")
                _model_cooldowns[model_id] = time.time() + 3600
            except Exception as e:
                log.warning(f"{model_id} no-tools retry failed: {e}")
                _model_cooldowns[model_id] = time.time() + 3600
            continue

        if resp.status_code == 200:
            used_provider, used_model_id, used_display, used_url = provider, model_id, display_name, api_url
            _model_cooldown_hits[model_id] = 0   # reset backoff on success
            break

        log.error(f"{model_id} returned {resp.status_code}: {resp.text[:200]}")
        # Non-429/400 error — still try next model

    # ── All models exhausted ───────────────────────────────────────────────────
    if resp is None or resp.status_code != 200:
        # Build a helpful message listing cooldown expirations
        cooldown_info = []
        for entry in effective_chain:
            mid, dname = entry[1], entry[2]
            exp = _model_cooldowns.get(mid, 0)
            if exp > time.time():
                mins = round((exp - time.time()) / 60)
                cooldown_info.append(f"- **{dname}**: resets in ~{mins} min")
        info_str = "\n".join(cooldown_info) if cooldown_info else "Check API keys."
        return JSONResponse({
            "text": f"All AI models are currently rate-limited. Please wait and try again.\n\n{info_str}",
            "map_actions": [], "model_used": None,
        })

    # ── Parse successful response ──────────────────────────────────────────────
    try:
        data = resp.json()
        choice = data["choices"][0]["message"]
        text = choice.get("content") or ""
        map_actions = []

        for tc in choice.get("tool_calls", []):
            if tc.get("function", {}).get("name") == "map_control":
                try:
                    args = json.loads(tc["function"]["arguments"])
                    if isinstance(args, list):
                        map_actions.extend(args)
                    elif "actions" in args:
                        map_actions.extend(args["actions"])
                    elif "type" in args:
                        map_actions.append(args)
                    else:
                        for val in args.values():
                            if isinstance(val, list):
                                map_actions.extend(val)
                                break
                except Exception as e:
                    log.warning(f"Tool parse error: {e}")

        # Text-fallback: extract ```json_actions ... ``` block from text.
        # Used by non-tool-capable models (llama-3.1-8b) and by tool-capable
        # models whose tool call was rejected and retried without tools.
        def _extract_actions(txt):
            if not txt:
                return [], txt
            m = re.search(r"```json_actions\s*(\[.*?\])\s*```", txt, re.DOTALL)
            if not m:
                return [], txt
            try:
                parsed = json.loads(m.group(1))
                if isinstance(parsed, list):
                    cleaned = re.sub(r"```json_actions\s*\[.*?\]\s*```", "", txt, flags=re.DOTALL).strip()
                    return parsed, cleaned
            except Exception as e:
                log.warning(f"json_actions parse error: {e}")
            return [], txt

        if not map_actions:
            extracted, text = _extract_actions(text)
            if extracted:
                map_actions.extend(extracted)
                log.info(f"{used_model_id}: extracted {len(extracted)} actions from json_actions block")

        # Deterministic fallback: when the LLM describes a map action in prose
        # but doesn't emit a json_actions block, infer the actions from the
        # user's query via keyword + street-name matching. No extra LLM call,
        # guaranteed outcome for common patterns.
        if not map_actions:
            inferred = infer_actions_from_query(message)
            if inferred:
                map_actions.extend(inferred)
                log.info(f"{used_model_id}: inferred {len(inferred)} actions from user query "
                         f"(LLM emitted prose without json_actions block)")

        if not text and map_actions:
            # LLM returned only a tool call — request follow-up text
            log.warning(f"{used_model_id}: tool call with no text — requesting follow-up")
            followup_messages = messages_with_tools + [
                {"role": "assistant", "content": None, "tool_calls": choice.get("tool_calls", [])},
                {"role": "tool",
                 "tool_call_id": (choice.get("tool_calls") or [{}])[0].get("id", "tc_0"),
                 "content": "Map updated successfully."},
                {"role": "user",
                 "content": "Now write a detailed analysis report for what was just shown. "
                            "Include street name, risk scores, primary driver, key statistics. "
                            "Text only — no tool calls."},
            ]
            try:
                resp2 = await asyncio.to_thread(
                    lambda: requests.post(
                        used_url,
                        headers={"Authorization": f"Bearer {_api_key(used_provider)}",
                                 "Content-Type": "application/json"},
                        json={"model": used_model_id, "messages": followup_messages,
                              "max_tokens": 600, "temperature": 0.3},
                        timeout=30,
                    )
                )
                if resp2.status_code == 200:
                    text = resp2.json()["choices"][0]["message"].get("content", "") or "Map updated."
                else:
                    text = "Map updated."
            except Exception:
                text = "Map updated."

        log.info(f"Chat answered by {used_display} | actions={len(map_actions)} text={len(text)}chars")
        return JSONResponse({"text": text, "map_actions": map_actions, "model_used": used_display})

    except Exception as e:
        log.error(f"Response parse error ({used_model_id}): {e}")
        return JSONResponse({
            "text": "Unable to parse the AI response. Please try again.",
            "map_actions": [], "model_used": used_display,
        })


# ── Existing upload endpoints ──────────────────────────────────────────────────

@app.post("/api/upload/survey")
async def upload_survey(file: UploadFile = File(...)):
    global survey_data, analysis
    suf = Path(file.filename).suffix
    if suf not in (".xlsx", ".xls", ".csv"):
        raise HTTPException(400, "Upload Excel or CSV")
    # Write to a short-lived temp file (pandas needs a file path, not bytes)
    tmp = OUT / f"uploaded_survey{suf}"
    try:
        with open(tmp, "wb") as f:
            f.write(await file.read())
        # Run blocking geocoding in a thread — keeps event loop responsive
        loop = asyncio.get_event_loop()
        survey_data = await loop.run_in_executor(None, process_survey, tmp)
        # Tag the payload with its source filename so the Update Data modal
        # can display it — ignored by everything else.
        try: survey_data['source_filename'] = file.filename
        except Exception: pass
        # Tag match_status (G2 by default until IAQ promotes them) and
        # dedup at parcel rep-point so multiple CSV rows for the same
        # household collapse to a single dot.
        feats = survey_data.get('features', [])
        tag_contact_match_status(feats)
        feats = dedup_contacts_at_parcel(feats)
        survey_data['features'] = feats
        analysis = compute_analysis(survey_data, parcels_data)
        n = len(feats)
        label = f"Upload {_datetime.now(_tz.utc).date().isoformat()} — {n} contacts · {file.filename}"
        await asyncio.to_thread(_sb_save, 'community_contact', survey_data)
        await asyncio.to_thread(_sb_save_version, 'community_contact', survey_data, label, n)
        if analysis:
            await asyncio.to_thread(_sb_save, 'analysis', analysis)
        return {"status": "ok", "points": n, "filename": file.filename}
    finally:
        # Always delete the temp file immediately — never leave data on disk
        tmp.unlink(missing_ok=True)


@app.post("/api/upload/results")
async def upload_results(file: UploadFile = File(...)):
    global survey_results
    suf = Path(file.filename).suffix
    file_bytes = await file.read()
    # Process entirely in memory — no disk write
    df = pd.read_csv(io.BytesIO(file_bytes)) if suf == ".csv" else pd.read_excel(io.BytesIO(file_bytes))
    survey_results = {"columns": list(df.columns), "rows": df.fillna("").to_dict("records"),
                      "count": len(df)}
    return {"status": "ok", "rows": len(df), "columns": list(df.columns)}


@app.post("/api/upload/parcels")
async def upload_parcels(file: UploadFile = File(...)):
    global parcels_data, analysis
    suf = Path(file.filename).suffix.lower()
    tmp = OUT / f"uploaded_parcels{suf}"
    with open(tmp, "wb") as f:
        f.write(await file.read())
    try:
        if suf in (".geojson", ".json"):
            gdf = gpd.read_file(tmp)
        elif suf == ".zip":
            gdf = gpd.read_file(f"zip://{tmp}")
        else:
            raise HTTPException(400, "Upload GeoJSON or zipped shapefile")
        if gdf.crs and str(gdf.crs) != "EPSG:4326":
            gdf = gdf.to_crs(epsg=4326)
        txt = gdf.to_json()
        CACHE_PAR.write_text(txt)
        parcels_data = json.loads(txt)
        await asyncio.to_thread(_build_parcel_index, parcels_data)
        analysis = compute_analysis(survey_data, parcels_data)
        # Persist so Vercel dashboard reads fresh data without re-ingesting
        try:
            await asyncio.to_thread(_sb_save, 'parcels', parcels_data)
            if analysis:
                await asyncio.to_thread(_sb_save, 'analysis', analysis)
        except Exception as e:
            log.warning(f"Could not persist parcels/analysis blobs: {e}")
        return {"status": "ok", "parcels": len(gdf)}
    except Exception as e:
        raise HTTPException(400, str(e))


FIELD_WEB = BASE / "keystone_field_web"


@app.get("/field")
@app.get("/field/")
async def field_root():
    return FileResponse(FIELD_WEB / "index.html")


@app.get("/field/{path:path}")
async def field_file(path: str):
    target = FIELD_WEB / path
    if target.exists() and target.is_file():
        return FileResponse(target)
    return FileResponse(FIELD_WEB / "index.html")


app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8050))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
