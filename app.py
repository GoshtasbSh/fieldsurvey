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
from pathlib import Path
from collections import defaultdict
from math import radians, sin, cos, sqrt, atan2

import pandas as pd
import geopandas as gpd
import shapely
import requests
from contextlib import asynccontextmanager
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

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE = Path(__file__).parent
DATA = BASE / "data"
OUT = BASE / "output"
STATIC = BASE / "static"
SURVEY_FILE = DATA / "Community Survey Contact Data .xlsx"
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


# ── IAQ score helpers ──────────────────────────────────────────────────────────

def _freq_score(val):
    """Convert symptom frequency string to 0–4 numeric score."""
    if not val or pd.isna(val):
        return 0
    v = str(val).lower()
    if 'weekly' in v:
        return 4
    if 'month' in v:
        return 3
    if 'season' in v:
        return 2
    if 'year' in v:
        return 1
    return 0  # rarely or never


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
    # Mold: +30
    mold = row.get('Mold')
    if mold and not pd.isna(mold) and str(mold).strip() not in ('', 'nan'):
        score += 30
    # Leakage per area: +7.5 each (4 areas, max 30)
    for col in ['Leakage 2_1', 'Leakage 2_2', 'Leakage 2_3', 'Leakage 2_4']:
        val = str(row.get(col, '') or '').lower().strip()
        if val and val not in ('none', 'nan', ''):
            score += 7.5
    # Cooling system age (column has non-breaking space \xa0): old = +4, unknown = +2
    for col in ['Cooling System\xa0_1', 'Cooling System\xa0_2',
                'Cooling System\xa0_3', 'Cooling System\xa0_4']:
        val = str(row.get(col, '') or '').lower()
        if 'more than 15' in val:
            score += 4
        elif "don't know" in val or 'not applicable' in val:
            score += 2
    # Gas/propane cooking: +10
    if any(kw in str(row.get('Cooking ', '') or '').lower() for kw in ('gas', 'propane')):
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


# ── IAQ survey pipeline ────────────────────────────────────────────────────────

def process_iaq_survey(csv_bytes: bytes):
    """
    Process Qualtrics IAQ survey CSV entirely in memory (never written to disk).

    Qualtrics CSV structure:
      Row 0  – machine column names  → header
      Row 1  – human-readable labels → skip
      Row 2  – ImportId metadata     → skip
      Row 3+ – actual survey data

    Returns (geojson, analysis, street_stats, validation)
    """
    raw = pd.read_csv(io.BytesIO(csv_bytes), skiprows=[1, 2], low_memory=False)
    df = raw[raw['Finished'].astype(str).str.lower() == 'true'].copy().reset_index(drop=True)
    log.info(f"IAQ survey: {len(df)}/{len(raw)} finished responses")

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

    for _, row in df.iterrows():
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

        # ── Coordinates: GPS → address match → Census geocoding ──────────────
        lat_q = pd.to_numeric(row.get('LocationLatitude'), errors='coerce')
        lon_q = pd.to_numeric(row.get('LocationLongitude'), errors='coerce')

        coord_source = 'gps'
        coords = None

        if (pd.notna(lat_q) and pd.notna(lon_q) and
                KH_LAT_MIN <= float(lat_q) <= KH_LAT_MAX and
                KH_LON_MIN <= float(lon_q) <= KH_LON_MAX):
            # Tier 1: valid in-field GPS from Qualtrics
            coords = [round(float(lon_q), 6), round(float(lat_q), 6)]
        else:
            q212_str = str(q212).strip()
            if q212_str and q212_str.lower() not in ('', 'ttt', 'nan'):
                # Tier 2: text-match Q212 address against geocoded contact list
                lng_m, lat_m, matched_addr, match_type = _address_match(q212_str, contact_lookup)
                if lng_m is not None:
                    coords = [round(float(lng_m), 6), round(float(lat_m), 6)]
                    coord_source = 'address_matched'
                    address_matched += 1
                    # Always use the clean contact address for the street name so that
                    # "Bucknell Ave", "Bucknell Avenue", "Bucknell Ave KH" all become
                    # the same street and are grouped together in analysis.
                    street_name = _extract_street_name(matched_addr) or street_name
                    log.debug(f"  addr match ({match_type}): {q212_str!r} → {matched_addr!r}")
                else:
                    # Tier 3: Census geocoding for anything that couldn't be matched
                    geocode_fallbacks += 1
                    coord_source = 'geocoded'
                    lng_g, lat_g, matched = geocode(q212_str)
                    if lng_g is not None:
                        coords = [round(float(lng_g), 6), round(float(lat_g), 6)]
                        if street_name == 'Unknown':
                            street_name = _extract_street_name(matched or '') or 'Unknown'
                        time.sleep(0.25)

        if coords is None:
            geocode_fails += 1
            continue

        # Anonymised properties — no name, no email, no full address
        mold_val = row.get('Mold')
        has_mold = bool(mold_val and not pd.isna(mold_val) and
                        str(mold_val).strip() not in ('', 'nan'))

        ow_raw = str(row.get('Ownership', '') or '').lower()
        ownership = 'Owner' if 'owner' in ow_raw else ('Renter' if 'renter' in ow_raw else 'Other')

        features.append({
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': coords},
            'properties': {
                'street_name':     street_name,
                'health_score':    health,
                'iaq_score':       iaq,
                'struct_score':    struct,
                'overall_risk':    risk,
                'risk_tier':       tier,
                'color':           tier_color,
                'ownership':       ownership,
                'housing_type':    str(row.get('QID128', '') or ''),
                'year_built':      str(row.get('QID192', '') or ''),
                'condition':       str(row.get('QID141', '') or ''),
                'has_mold':        has_mold,
                'respiratory_ill': str(row.get('RespIll', '') or ''),
                'asthma_freq':     str(row.get('asthma', '') or ''),
                'wheeze_freq':     str(row.get('wheeze', '') or ''),
                'headache_freq':   str(row.get('Headache', '') or ''),
                'hospital_visit':  ('yes' if 'yes' in str(row.get('Hospital Respiratory', '') or '').lower()
                                    else 'no'),
                'coord_source':    coord_source,
            }
        })

    log.info(f"IAQ: {len(features)} placed on map — "
             f"GPS: {len(features) - address_matched - geocode_fallbacks + geocode_fails}, "
             f"address-matched: {address_matched}, "
             f"Census geocoded: {geocode_fallbacks - geocode_fails}, "
             f"failed/skipped: {geocode_fails}")

    geojson = {'type': 'FeatureCollection', 'features': features}
    analysis_result = _compute_iaq_analysis(features)
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
        lng, lat, matched = geocode(addr)

        if lng and lat:
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lng, 6), round(lat, 6)]},
                "properties": {
                    "id": int(i), "address": addr, "status": status,
                    "status_detail": detail, "second_attempt": second,
                    "date": dt, "notes": notes, "street_name": street,
                    "matched_address": matched or "",
                    "color": STATUS.get(status, "#9ca3af"),
                },
            })
        else:
            fails.append(addr)
        time.sleep(0.25)

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


@asynccontextmanager
async def lifespan(application):
    global survey_data, parcels_data, analysis, iaq_data, iaq_analysis, street_stats, iaq_validation
    log.info("=" * 50)
    log.info("  KeyStone Field Survey Dashboard")
    log.info("=" * 50)

    # Wipe any data files left on disk from a previous session — privacy requirement.
    # Sensitive survey/IAQ data must never persist across server restarts.
    for stale in [CACHE_PTS, CACHE_IAQ, CACHE_RES]:
        if stale.exists():
            try:
                stale.unlink()
                log.info(f"Privacy cleanup: removed {stale.name}")
            except Exception as e:
                log.warning(f"Could not remove {stale.name}: {e}")
    # Also wipe any uploaded temp files
    for tmp in OUT.glob("uploaded_*"):
        try:
            tmp.unlink()
        except Exception:
            pass

    # Always start with empty survey and IAQ data — upload required each session
    survey_data = {"type": "FeatureCollection", "features": []}
    parcels_data = process_parcels()   # parcels are base map context, not respondent data
    analysis = compute_analysis(survey_data, parcels_data)
    log.info("Survey and IAQ data: empty — upload required each session")
    log.info("-" * 50)
    log.info("  Ready! Open http://localhost:8050")
    log.info("-" * 50)
    yield


app = FastAPI(title="KeyStone Survey Dashboard", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Standard endpoints ─────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return FileResponse(STATIC / "index.html")


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

@app.get("/api/iaq-points")
async def api_iaq_pts():
    if not iaq_data:
        return JSONResponse({"type": "FeatureCollection", "features": []})
    return JSONResponse(iaq_data)


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


@app.post("/api/upload/iaq")
async def upload_iaq(file: UploadFile = File(...)):
    """Upload and process the Keystone Heights Survey Qualtrics CSV (in-memory only)."""
    global iaq_data, iaq_analysis, street_stats, iaq_validation

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

    try:
        iaq_data, iaq_analysis, street_stats, iaq_validation = process_iaq_survey(csv_bytes)
    except Exception as e:
        log.error(f"IAQ processing error: {e}")
        raise HTTPException(400, f"Processing failed: {e}")

    n = len(iaq_data.get("features", []))
    n_streets = len([s for s, d in street_stats.items() if not d.get("insufficient_data")])
    log.info(f"IAQ data ready: {n} points, {n_streets} streets — kept in memory only")

    return {
        "status": "ok",
        "points": n,
        "streets_analyzed": n_streets,
        "mean_risk": iaq_analysis.get("scores", {}).get("mean_risk", 0),
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
        analysis = compute_analysis(survey_data, parcels_data)
        return {"status": "ok", "points": len(survey_data.get("features", []))}
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
        analysis = compute_analysis(survey_data, parcels_data)
        return {"status": "ok", "parcels": len(gdf)}
    except Exception as e:
        raise HTTPException(400, str(e))


app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8050))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
