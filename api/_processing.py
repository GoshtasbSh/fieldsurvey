"""
Shared processing logic for KeyStone Vercel API functions.

Mirrors app.py exactly — same scores, same geocoding, same parcel snapping,
same IAQ↔contact matching.  Uses only packages in api/requirements.txt:
  pandas, numpy, shapely, openpyxl, supabase  (+ stdlib).

No global state: ParcelIndex class replaces the global _parcel_* variables
so each stateless Vercel invocation builds its own short-lived index.
"""
from __future__ import annotations

import re
import io
import json
import logging
import difflib
import urllib.request
import urllib.parse
from collections import defaultdict
from datetime import date
from math import radians, sin, cos, sqrt, atan2
from pathlib import Path

import pandas as pd
from shapely.geometry import shape as _shp_shape, Point as _ShapelyPoint
from shapely.strtree import STRtree as _STRtree

# ── Constants (identical to app.py) ───────────────────────────────────────────
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

PII_COLS = {
    'RecipientLastName', 'RecipientFirstName', 'RecipientEmail',
    'IPAddress', 'ExternalReference', 'Q_RecaptchaScore',
    'Q_RelevantIDDuplicate', 'Q_RelevantIDDuplicateScore',
    'Q_RelevantIDFraudScore', 'Q_RelevantIDLastStartDate', 'Q_DuplicateRespondent',
}

KH_LAT_MIN, KH_LAT_MAX = 29.60, 29.95
KH_LON_MIN, KH_LON_MAX = -82.20, -81.75

# Columns the IAQ scorers read. If any are missing in a Qualtrics export the
# affected score silently drops to 0 — surface a warning instead.
EXPECTED_IAQ_COLUMNS = {
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

# Survey-question metadata: field_name → (orig_csv_col_idx, question_text).
# Many of these columns have blank or duplicate Qualtrics headers (matrix
# sub-items export as ' _1', ' _2', …; standalone questions sometimes export
# with a literal single-space header). We pin them by ORIGINAL CSV column
# index so renames or PII drops cannot shift the mapping. Question text is
# pulled from the CSV's descriptor row (row 1) for use in chart subtitles.
SURVEY_QUESTIONS = {
    # ── Residency & Housing (R1–R8) ───────────────────────────────────────────
    'years_in_hre':       (27, 'How long have you lived in High Ridge Estates? (years)'),
    'reloc_factor_emp':   (29, 'Relocation factor — Employment opportunities nearby'),
    'reloc_factor_aff':   (30, 'Relocation factor — Affordable housing'),
    'reloc_factor_qol':   (31, 'Relocation factor — Quality of Life'),
    'reloc_factor_fam':   (32, 'Relocation factor — Proximity to family and friends'),
    'reloc_factor_ret':   (33, 'Relocation factor — Retirement'),
    'reloc_factor_env':   (34, 'Relocation factor — Environmental quality and access to nature'),
    'reloc_factor_inh':   (35, 'Relocation factor — Inherited property'),
    'reloc_factor_oth':   (36, 'Relocation factor — Other'),
    'mh_skirting':        (42, 'If you live in a mobile home, does your home have its skirting intact?'),
    'anticipated_stay':   (44, 'How long do you anticipate continuing to live in your current house?'),
    'safety_env':         (56, 'Do you feel safe in your house in terms of environmental threats (flooding, heatwaves, heavy rain/wind)?'),
    'safety_social':      (57, 'Do you feel safe in your house in terms of social threats (loose pets, concerns about neighbors, etc.)?'),
    'afford_urgency':     (58, 'How would you rate the urgency of having affordable housing in High Ridge Estates?'),
    'afford_strategy':    (59, 'In your opinion, what is the most effective strategy to improve housing affordability in HRE?'),

    # ── Community Living: home-resilience interventions matrix (C1, 11 items) ─
    'intv_roof_walls':    (67, 'Intervention — Strengthen the roof and walls against severe weather'),
    'intv_windows_doors': (68, 'Intervention — Upgrade windows and doors to be more energy-efficient'),
    'intv_rain_gardens':  (69, 'Intervention — Install rain gardens to manage stormwater on my property'),
    'intv_hvac':          (70, 'Intervention — Improve heating/cooling system(s)'),
    'intv_plumbing_elec': (71, 'Intervention — Improve plumbing or electrical systems for reliability'),
    'intv_well_septic':   (72, 'Intervention — Replace well/septic'),
    'intv_ccua_water':    (73, 'Intervention — Connect to city water through CCUA'),
    'intv_fence':         (74, 'Intervention — Add a fence for safety'),
    'intv_trees_shade':   (75, 'Intervention — Plant more trees around my home for shade and cooling'),
    'intv_trim_trees':    (76, 'Intervention — Trim trees'),
    'intv_drainage':      (77, 'Intervention — Improved drainage'),

    # ── Community Living: experiences in HRE matrix (C2, 10 items) ────────────
    'exp_flooding':        (84, 'Experience — Flooding of house due to any disaster (e.g., hurricane)'),
    'exp_flood_help':      (85, 'Experience — In case of flooding, received help for cleaning'),
    'exp_extreme_heat':    (86, 'Experience — Extreme heat in recent years'),
    'exp_school_change':   (87, "Experience — Changing your kids' school due to moving"),
    'exp_law_enf':         (88, 'Experience — Calling law enforcement because of problem with neighbors'),
    'exp_insurance_loss':  (89, 'Experience — Losing home owners insurance due to age of home'),
    'exp_well_dry':        (90, 'Experience — Well drying up'),
    'exp_pests':           (91, 'Experience — A problem with pests in your home'),
    'exp_water_leaks':     (92, 'Experience — A problem with water leaks'),
    'exp_loose_animals':   (93, 'Experience — A problem with loose animals'),

    # ── Well-being & Mobility (W1, W2) ────────────────────────────────────────
    'car_access':          (133, 'Do you (or your household) own or have regular access to a car?'),
    'hurricane_transport': (134, 'During hurricanes/disasters, have you experienced transportation problems (e.g., difficulty evacuating)?'),

    # ── Demographics+ (D1, D2) ────────────────────────────────────────────────
    'education':           (142, 'What is the highest level of education you have completed?'),
    'employment':          (143, 'Which best describes your employment status?'),
}

# Highlights rendered in accent color in the dashboard's matrix charts.
INTERVENTION_HIGHLIGHTS = ('intv_roof_walls', 'intv_ccua_water')
EXPERIENCE_HIGHLIGHTS = ('exp_law_enf', 'exp_insurance_loss', 'exp_well_dry',
                         'exp_pests', 'exp_water_leaks', 'exp_loose_animals')

# Matrix display order (UI renders bars in this order before sorting by %)
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

# Source-question captions for every chart_id rendered in the dashboard.
# Each entry calls out the Qualtrics column(s) and the SURVEY_QUESTIONS
# Q-number (= original CSV column index) so analysts can trace any
# visualisation back to the specific question it summarises. Format
# convention:
#     'chart_id': 'CSV-column / QID (Q<idx>, "canonical text") — role'
# For composites: list each component separated by ' + '.
# Q-numbers (Q27, Q44, …) are the original CSV column indices stored
# as the first tuple element in SURVEY_QUESTIONS — the ONLY stable
# Qualtrics-side identifier this codebase exposes for non-QID columns.
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
    'years_in_hre':       'CSV col 27 (Q27) — "How long have you lived in High Ridge Estates? (years)"',
    'anticipated_stay':   'CSV col 44 (Q44) — "How long do you anticipate continuing to live in your current house?"',
    'mh_skirting':        'CSV col 42 (Q42) — "If you live in a mobile home, does your home have its skirting intact?"',
    'safety_env':         'CSV col 56 (Q56) — "Do you feel safe in your house in terms of environmental threats (flooding, heatwaves, heavy rain/wind)?"',
    'safety_social':      'CSV col 57 (Q57) — "Do you feel safe in your house in terms of social threats (loose pets, concerns about neighbors, etc.)?"',
    'afford_urgency':     'CSV col 58 (Q58) — "How would you rate the urgency of having affordable housing in HRE?"',
    'afford_strategy':    'CSV col 59 (Q59) — "What is the most effective strategy to improve housing affordability in HRE?"',
    'reloc_factors':      'CSV cols 29–36 (Q29–Q36) matrix — relocation-factor importance (Employment / Affordability / Quality of Life / Family / Retirement / Environment / Inheritance / Other)',
    # ── Community living matrix charts ───────────────────────────────────────
    'interventions_pct':  'CSV cols 67–77 (Q67–Q77) matrix — % wanting each home-resilience intervention (roof/walls, windows/doors, rain gardens, HVAC, plumbing/elec, well/septic, CCUA water, fence, trees-shade, trim trees, drainage)',
    'experiences_pct':    'CSV cols 84–93 (Q84–Q93) matrix — % reporting each HRE experience (flooding, flood help, extreme heat, school change, law enforcement, insurance loss, well drying, pests, water leaks, loose animals)',
    # ── Well-being & Mobility ────────────────────────────────────────────────
    'car_access':         'CSV col 133 (Q133) — "Do you (or your household) own or have regular access to a car?"',
    'hurricane_transport':'CSV col 134 (Q134) — "During hurricanes/disasters, have you experienced transportation problems (e.g., difficulty evacuating)?"',
    # ── Demographics+ ────────────────────────────────────────────────────────
    'education':          'CSV col 142 (Q142) — "What is the highest level of education you have completed?"',
    'employment':         'CSV col 143 (Q143) — "Which best describes your employment status?"',
}


def _validate_iaq_columns(df_columns) -> dict:
    """Compare a Qualtrics CSV's columns against the expected manifest.

    Qualtrics sometimes exports column names with no-break space (\\xa0) — we
    normalize both sides before comparison so legitimate exports don't
    register as missing.
    """
    have = {str(c).replace('\xa0', ' ').strip() for c in df_columns}
    missing_by_group: dict = {}
    for group, cols in EXPECTED_IAQ_COLUMNS.items():
        gone = [c for c in cols if c.replace('\xa0', ' ').strip() not in have]
        if gone:
            missing_by_group[group] = gone
    return missing_by_group

PARCEL_GEOJSON = Path(__file__).parent.parent / 'output' / 'parcels_keystone.geojson'


# ── Multipart form-data parser ─────────────────────────────────────────────────

def parse_multipart_file(content_type: str, body: bytes) -> tuple[str | None, bytes | None]:
    """Extract the 'file' field from a multipart/form-data body.
    Returns (filename, file_bytes) or (None, None) if not found."""
    boundary = None
    for tok in content_type.split(';'):
        tok = tok.strip()
        if tok.lower().startswith('boundary='):
            boundary = tok[9:].strip('"').strip("'")
    if not boundary:
        print(f"[multipart] no boundary found in content-type: {content_type[:200]!r}")
        return None, None

    sep = b'--' + boundary.encode('ascii', errors='replace')
    for raw in body.split(sep):
        if b'\r\n\r\n' not in raw:
            continue
        h_bytes, content = raw.split(b'\r\n\r\n', 1)
        content = content.rstrip(b'\r\n')
        h_str = h_bytes.decode('utf-8', errors='ignore')
        if 'name="file"' not in h_str and "name='file'" not in h_str:
            continue
        filename = None
        for line in h_str.split('\r\n'):
            for tok in line.split(';'):
                tok = tok.strip()
                if tok.lower().startswith('filename='):
                    filename = tok[9:].strip('"').strip("'")
        if filename:
            # Cap filename length and strip newlines (defense against
            # log injection and oversized labels in Supabase).
            filename = filename.replace('\r', ' ').replace('\n', ' ')[:255]
        return filename, content
    return None, None


# ── ParcelIndex class (replaces global _parcel_* vars from app.py) ─────────────

class ParcelIndex:
    """Parcel address lookup + STRtree for spatial snapping.  Instantiated once per request."""

    def __init__(self):
        self.addr_idx: dict = {}       # (house_num, street_core) → (lon, lat)
        self.by_house: dict = {}       # house_num → [(street_core, lon, lat)]
        self.strtree = None
        self.geoms_list: list = []     # [(geometry, lon, lat)]

    def build(self, parcel_geojson: dict) -> None:
        """Build from a GeoJSON FeatureCollection — identical logic to app.py."""
        features = parcel_geojson.get('features', [])
        if not features:
            return
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
                pt = geom.representative_point()
                lon, lat = round(pt.x, 6), round(pt.y, 6)
            except Exception:
                continue
            key = (house_num, s_core)
            lookup[key] = (lon, lat)
            by_house.setdefault(house_num, []).append((s_core, lon, lat))
            geoms.append((geom, lon, lat))
        self.addr_idx = lookup
        self.by_house = by_house
        if geoms:
            self.strtree = _STRtree([g[0] for g in geoms])
            self.geoms_list = geoms

    def snap(self, lon: float, lat: float, max_dist_m: float = 50) -> tuple | None:
        """Find nearest parcel representative_point within max_dist_m m.
        Returns (lon, lat) inside the parcel, or None.

        Default radius lowered from 150 m → 50 m on 2026-05-05. The 150 m
        cap was historical and over-attached suburban points to wrong
        parcels. 50 m ≈ 1.5 lot frontages in Keystone Heights, generous
        enough for normal Census-API offset, tight enough that two
        parcels rarely both qualify. Callers that want the looser value
        can pass it explicitly.
        """
        if self.strtree is None or not self.geoms_list:
            return None
        search_r = max_dist_m / 111_320
        try:
            idxs = self.strtree.query(_ShapelyPoint(lon, lat).buffer(search_r))
        except Exception:
            return None
        best_dist, best = float('inf'), None
        for idx in idxs:
            _, c_lon, c_lat = self.geoms_list[int(idx)]
            d = _haversine_m(lat, lon, c_lat, c_lon)
            if d < best_dist:
                best_dist = d
                best = (c_lon, c_lat)
        return best if best_dist <= max_dist_m else None

    def parcel_rep_point(self, lon: float, lat: float,
                         max_dist_m: float = 50) -> tuple | None:
        """Canonical-form helper: given any (lon, lat) — geocoded contact,
        Qualtrics-typed-address result, or door-GPS field pin — return
        the rep-point of the parcel that should represent this household,
        or None if no parcel within `max_dist_m`.

        Different from snap() only in intent: snap() is for moving a
        questionable point to a parcel; parcel_rep_point() is for getting
        the canonical match key. Both currently use nearest-neighbour
        with the same geometry; if we later switch to strict
        point-in-polygon, this helper is the place to change it.
        """
        return self.snap(lon, lat, max_dist_m=max_dist_m)

    def geocode(self, addr: str) -> tuple:
        """4-tier geocoding (identical to _parcel_geocode in app.py).
        Returns (lon, lat, matched_addr, source)."""
        parts = _parse_addr_parts(addr)
        if parts:
            house_num, s_core = parts
            # 1. Exact parcel match
            if (house_num, s_core) in self.addr_idx:
                lon, lat = self.addr_idx[(house_num, s_core)]
                return lon, lat, addr, 'parcel_exact'
            # 2. Fuzzy parcel match
            candidates = self.by_house.get(house_num, [])
            best_score, best_pos = 0.0, None
            for c_core, c_lon, c_lat in candidates:
                sc = difflib.SequenceMatcher(None, s_core, c_core).ratio()
                if sc > best_score:
                    best_score = sc
                    best_pos = (c_lon, c_lat)
            if best_score >= 0.75 and best_pos:
                return best_pos[0], best_pos[1], addr, 'parcel_fuzzy'
        # 3 & 4. Census geocoding + optional parcel snap
        lon, lat, matched = _census_geocode(addr)
        if lon is not None:
            snapped = self.snap(lon, lat)
            if snapped:
                return snapped[0], snapped[1], matched, 'parcel_snapped'
            return lon, lat, matched, 'geocoded'
        return None, None, None, 'failed'


def load_parcel_index() -> ParcelIndex:
    """Load parcels_keystone.geojson from the deployed project filesystem.
    Falls back to Supabase 'parcels' blob if file is absent."""
    idx = ParcelIndex()
    if PARCEL_GEOJSON.exists():
        parcel_data = json.loads(PARCEL_GEOJSON.read_text())
    else:
        try:
            import sys
            sys.path.append(str(Path(__file__).parent))
            from _lib import load_cached
            parcel_data = load_cached('parcels') or {'features': []}
        except Exception:
            parcel_data = {'features': []}
    idx.build(parcel_data)
    return idx


# ── Census geocoding (replaces requests.get in app.py) ────────────────────────

def _census_geocode(addr: str) -> tuple:
    """Census Bureau geocoding API via urllib (no external packages)."""
    full = re.sub(r'\s+', ' ', addr.strip()) + ', Keystone Heights, FL'
    params = urllib.parse.urlencode({
        'address': full,
        'benchmark': 'Public_AR_Current',
        'format': 'json',
    })
    url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?' + params
    try:
        with urllib.request.urlopen(url, timeout=12) as r:
            ms = json.loads(r.read()).get('result', {}).get('addressMatches', [])
        if ms:
            c = ms[0]['coordinates']
            return float(c['x']), float(c['y']), ms[0]['matchedAddress']
    except Exception:
        pass
    return None, None, None


# ── Haversine distance ─────────────────────────────────────────────────────────
# Import from _lib when available (same formula); fall back to local definition
# if _lib is not on sys.path (e.g. standalone testing outside api/).
try:
    from _lib import haversine_m as _haversine_m
except ImportError:
    def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = 6_371_000
        dlat = radians(lat2 - lat1)
        dlon = radians(lon2 - lon1)
        a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
        return 2 * R * atan2(sqrt(a), sqrt(1 - a))


# ── IAQ score helpers (identical to app.py; pd.isna replaced) ─────────────────

def _isna(val) -> bool:
    """Drop-in replacement for pd.isna for scalar values."""
    if val is None:
        return True
    try:
        return str(val).strip().lower() in ('', 'nan', 'none', 'nat')
    except Exception:
        return False


def _freq_score(val) -> int:
    if not val or _isna(val):
        return 0
    v = str(val).lower()
    if 'weekly' in v:  return 4
    if 'month'  in v:  return 3
    if 'season' in v:  return 2
    if 'year'   in v:  return 1
    return 0


def _compute_health_score(row) -> int:
    raw = (_freq_score(row.get('Headache')) * 0.5 +
           _freq_score(row.get('RespIll'))  * 1.0 +
           _freq_score(row.get('asthma'))   * 1.0 +
           _freq_score(row.get('wheeze'))   * 0.8 +
           _freq_score(row.get('Tired'))    * 0.3)
    score = min(raw / 14.4 * 80, 80)
    if 'yes' in str(row.get('Hospital Respiratory', '') or '').lower():
        score = min(score + 20, 100)
    return round(score)


def _compute_iaq_score(row) -> int:
    score = 0.0
    # Normalize column names: Qualtrics sometimes exports \xa0 (no-break space)
    # instead of regular space. Build a lookup once so both variants resolve.
    _nr = {str(k).replace('\xa0', ' '): v for k, v in row.items()}
    mold = _nr.get('Mold')
    if mold and not _isna(mold) and str(mold).strip() not in ('', 'nan'):
        score += 30
    for col in ['Leakage 2_1', 'Leakage 2_2', 'Leakage 2_3', 'Leakage 2_4']:
        val = str(_nr.get(col, '') or '').lower().strip()
        if val and val not in ('none', 'nan', ''):
            score += 7.5
    for col in ['Cooling System _1', 'Cooling System _2',
                'Cooling System _3', 'Cooling System _4']:
        val = str(_nr.get(col, '') or '').lower()
        if 'more than 15' in val:
            score += 4
        elif "don't know" in val or 'not applicable' in val:
            score += 2
    if any(kw in str(_nr.get('Cooking ', '') or '').lower() for kw in ('gas', 'propane')):
        score += 10
    return round(min(score, 100))


def _val_at_orig_idx(full_row, orig_idx):
    """Pull a raw cell value from the pre-PII-drop DataFrame row by ORIGINAL
    CSV column index. Used for blank-header / duplicate-header columns where
    name-based lookup is unreliable. Returns clean string ('' on miss/NaN).
    """
    try:
        v = full_row.iloc[orig_idx]
    except (IndexError, KeyError, AttributeError):
        return ''
    if v is None or _isna(v):
        return ''
    s = str(v).strip()
    return '' if s.lower() in ('nan', 'none') else s


def _parse_years_numeric(v):
    """Parse a free-text years answer (e.g. '10', '10 years', '10 yrs', '5.5')
    into a float. Returns None on parse failure."""
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


def _extract_survey_extras(full_row) -> dict:
    """Extract every SURVEY_QUESTIONS field from the pre-PII row by index.
    Also derives years_in_hre_num for histogram aggregation."""
    out = {field: _val_at_orig_idx(full_row, idx)
           for field, (idx, _) in SURVEY_QUESTIONS.items()}
    out['years_in_hre_num'] = _parse_years_numeric(out.get('years_in_hre'))
    return out


def _compute_struct_score(row) -> int:
    score = 0
    yr = str(row.get('QID192', '') or '').lower()
    if 'before 1960' in yr:   score += 30
    elif '1960' in yr:         score += 20
    elif '1980' in yr:         score += 10
    ht = str(row.get('QID128', '') or '').lower()
    if 'single wide' in ht:        score += 25
    elif 'double wide' in ht:      score += 15
    elif 'non-traditional' in ht or 'camper' in ht:  score += 20
    cond = str(row.get('QID141', '') or '').lower()
    if 'poor' in cond:   score += 25
    elif 'fair' in cond: score += 15
    return round(min(score, 100))


# ── Address utilities (verbatim from app.py) ───────────────────────────────────

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

_SUFFIX_RE = re.compile(
    r'\b(ave(?:nue)?|dr(?:ive)?|st(?:reet)?|r(?:oa)?d|blvd|boulevard|'
    r'ln|lane|ct|court|pl|place|cir(?:cle)?|way|ter(?:race)?|'
    r'pkwy|parkway|hwy|highway)\b\.?',
    re.IGNORECASE,
)

_KNOWN_SUFFIX_CORES = ['ave', 'avenue', 'dr', 'drive', 'st', 'street', 'rd', 'road',
                       'blvd', 'boulevard', 'ln', 'lane', 'ct', 'court', 'pl', 'place',
                       'cir', 'circle', 'way', 'ter', 'terrace', 'pkwy', 'parkway']


def _abbrev_suffix(name: str) -> str:
    for pat, abbrev in _SUFFIX_ABBREV:
        name = pat.sub(abbrev, name)
    return name


def _extract_street_name(addr) -> str | None:
    if not addr or _isna(addr):
        return None
    s = str(addr).strip()
    if s.lower() in ('', 'ttt', 'nan'):
        return None
    s = re.sub(r'^\d+\s+', '', s)
    s = re.sub(r',?\s*(Keystone Heights|KH|FL|Florida|\d{5}).*$', '', s,
               flags=re.IGNORECASE).strip()
    s = _abbrev_suffix(s)
    return s or None


def _street_core(text: str) -> str:
    s = str(text).strip()
    s = re.sub(r',?\s*(Keystone Heights|KH|FL|Florida|\d{5}).*$', '', s, flags=re.IGNORECASE)
    s = _SUFFIX_RE.sub('', s)
    s = re.sub(r'\s+', ' ', s).strip().lower()
    words = s.split()
    if len(words) >= 2:
        last = words[-1]
        if any(difflib.SequenceMatcher(None, last, sfx).ratio() >= 0.70
               for sfx in _KNOWN_SUFFIX_CORES):
            s = ' '.join(words[:-1])
    return s


def _parse_addr_parts(addr) -> tuple | None:
    if not addr or str(addr).strip().lower() in ('', 'nan', 'ttt'):
        return None
    m = re.match(r'^(\d+)\s+(.+)$', str(addr).strip())
    if not m:
        return None
    return m.group(1), _street_core(m.group(2))


def _build_contact_lookup(contact_features: list) -> dict:
    lookup = {}
    for f in contact_features:
        addr = f['properties'].get('address', '')
        lon_c, lat_c = f['geometry']['coordinates']
        parsed = _parse_addr_parts(addr)
        if parsed:
            lookup[parsed] = (lon_c, lat_c, addr)
    return lookup


def _build_known_streets(contact_lookup: dict) -> dict:
    known = {}
    for (_house_num, s_core), (_lon, _lat, addr) in contact_lookup.items():
        canonical = _extract_street_name(addr)
        if canonical and s_core and s_core not in known:
            known[s_core] = canonical
    return known


def _canonicalize_street(name: str, known_streets: dict, threshold: float = 0.85) -> str:
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


def _address_match(q212: str, lookup: dict) -> tuple:
    parsed = _parse_addr_parts(q212)
    if not parsed:
        return None, None, None, None
    house_num, s_core = parsed
    if (house_num, s_core) in lookup:
        lon_c, lat_c, addr = lookup[(house_num, s_core)]
        return lon_c, lat_c, addr, 'exact'
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


# ── IAQ↔Contact matching (identical to app.py) ────────────────────────────────

def _match_iaq_to_contacts(iaq_features: list, contact_features: list,
                            coord_eq_m: float = 1.0) -> dict:
    """Match IAQ responses to community contacts via parcel-centre coords.

    Three tiers, no distance fallback:

      1. **Address exact** — raw Q212 ↔ contact address after
         normalisation. Catches typed-address matches.
      2. **Address fuzzy** — same house number, fuzzy street ≥ 0.70.
         Catches typos / abbreviations.
      3. **Parcel rep-point equality** (NEW v3) — both sides have
         already been geocoded through `parcel_idx.geocode()` which
         snaps to the parcel's representative_point. Same household =
         same rep-point (within `coord_eq_m`, default 1 m to absorb
         rounding noise). This catches cases where the typed addresses
         differ but both resolved to the same parcel.

    No more radius-based distance fallback. With both sides at parcel
    centres, "near but different parcel" is a different household and
    must NOT match. Unmatched IAQ stays unmatched (flyer respondent).

    Returns dict: iaq_index → contact_index. Bipartite (each contact
    matched at most once).
    """
    addr_lookup: dict = {}
    by_house: dict = {}
    for ci, cf in enumerate(contact_features):
        addr = cf['properties'].get('address', '')
        parsed = _parse_addr_parts(addr)
        if parsed:
            h, c = parsed
            addr_lookup[(h, c)] = ci
            by_house.setdefault(h, []).append((c, ci))

    # Reverse-lookup table: contact rep-point coord → contact index. Used
    # by tier 3 for O(1) coord equality. Quantised to ~1 m grid cells so
    # a 6-decimal-place coord pair (lon, lat) lines up across both sides
    # even with minor float rounding from the geocoder.
    cell_m = max(coord_eq_m, 1.0)
    deg_per_m_lat = 1.0 / 111_320.0
    coord_lookup: dict = {}
    for ci, cf in enumerate(contact_features):
        c_lon, c_lat = cf['geometry']['coordinates']
        deg_per_m_lon = deg_per_m_lat / max(0.05, abs(_cos_deg(c_lat)))
        kx = round(c_lon / (cell_m * deg_per_m_lon))
        ky = round(c_lat / (cell_m * deg_per_m_lat))
        coord_lookup.setdefault((kx, ky), []).append(ci)

    used_contacts: set = set()
    matches: dict = {}
    for ii, iaq_f in enumerate(iaq_features):
        q212 = iaq_f['properties'].get('raw_address', '')
        iaq_lon, iaq_lat = iaq_f['geometry']['coordinates']
        matched_ci = None

        # Tier 1 + 2: address-based.
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

        # Tier 3 (NEW): parcel rep-point equality. Both IAQ and contact
        # were geocoded through the same parcel-snap pipeline, so the
        # same household resolves to the same coord. Quantise to a
        # ~1 m grid for the equality check.
        if matched_ci is None:
            deg_per_m_lon = deg_per_m_lat / max(0.05, abs(_cos_deg(iaq_lat)))
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


def _cos_deg(deg: float) -> float:
    """Cosine of degrees, clamped to avoid div/0 near the poles."""
    from math import cos, radians
    return cos(radians(deg))


def tag_contact_match_status(contact_features: list) -> dict:
    """Tag each contact with `match_status` so the dashboard's circle
    stroke can encode the three groups (matched / contact_only / iaq_only).

    Rule:
      - Completed + has_iaq_survey=true → 'matched'   (G1, white stroke)
      - Completed + has_iaq_survey false → 'contact_only' (G2, amber stroke)
      - Otherwise → no match_status set (existing styling unchanged)

    Returns counts {'matched': n, 'contact_only': n} for callers that
    want to log how many of each group exist after a sync. Idempotent —
    calling twice produces the same result.
    """
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
            # Drop any stale match_status so a downgrade
            # (Completed → No Answer via re-upload) doesn't leave a
            # G1/G2 stroke on a dot that's now orange/red anyway.
            p.pop('match_status', None)
    return counts


# Status priority for parcel-level dedup. Higher rank = more
# informative outcome that should win the visible dot. The order
# follows the field team's ground-truth hierarchy: a successful
# contact (Completed → Follow Up → Left Info) outranks any
# can't-reach (No Answer → Inaccessible → Vacant), which in turn
# outrank an explicit refusal (Not Interested) and unknown buckets.
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
    rep-point into a single feature, keeping the highest-priority
    status. Dropped rows are stamped onto the survivor's
    `coincident_contacts` property so the popup can still surface
    their status / notes / collected_at.

    Why this exists:

    A parcel can appear in the CSV multiple times (two visits, repeat
    callbacks, multiple field-app pins for the same household). Before
    dedup, every row renders as its own dot at the same lat/lon. The
    Completed dot's wider G2 yellow stroke (2.8 px) pokes out around
    a stacked Left Info dot's narrower translucent rim (2.0 px),
    creating the visual artefact "Left Info has a yellow rim" that
    confused us into thinking the paint expression was wrong. Deduping
    here removes the stack entirely — only one dot per parcel, with
    the most informative status — so the rim seen on the map always
    matches the dot it's attached to.

    `cell_deg = 1e-5` ≈ 1.1 m at our latitude, which is tight enough
    that genuinely separate parcels are never collapsed. Two contacts
    that share an exact parcel-rep snap are guaranteed to land in the
    same cell; two that geocoded slightly off won't collide.

    Idempotent — survivor's geometry is preserved verbatim, so calling
    twice produces the same result.
    """
    if not features:
        return list(features) if features is not None else []

    buckets: dict = {}
    order: list = []
    for f in features:
        try:
            lon, lat = f["geometry"]["coordinates"][:2]
        except (KeyError, IndexError, TypeError):
            order.append(f)  # malformed geometry — pass through unchanged
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
            out.append(item)  # malformed-geometry passthrough
            continue
        group = buckets[item]
        if len(group) == 1:
            out.append(group[0])
            continue
        # Tie-break on has_iaq_survey so a Completed contact WITH a
        # Qualtric match always beats a Completed contact without one.
        # Without this, Python's stable sort keeps original CSV order
        # within the same status rank, so an unmatched row that
        # happens to come first in the CSV silently wins — and the
        # parcel renders as G2 (yellow rim) even though its IAQ
        # survey exists. Composite key:
        #   (status_rank ASC, has_iaq_survey desc) so True < False
        #   when we negate, i.e. matched comes first.
        group.sort(key=lambda f: (
            _contact_status_rank((f.get("properties") or {}).get("status")),
            0 if (f.get("properties") or {}).get("has_iaq_survey") else 1,
        ))
        winner = group[0]
        losers = group[1:]
        wp = winner.setdefault("properties", {})
        # If any loser carried IAQ-match info, copy the flags onto the
        # winner so the popup's "Qualtric matched" badge and the
        # Survey Answers tab still resolve. Without this, a winner
        # that didn't itself match an IAQ row would lose access to
        # the matched IAQ feature even though one of its co-located
        # losers did match.
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


def _upgrade_contacts_from_iaq(survey_feats: list, iaq_features: list,
                                matches: dict) -> int:
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
        # Store the matched IAQ's parcel-rep-point on the contact so the
        # popup can do an O(1) lookup of the IAQ feature for the Survey
        # Answers tab without a fresh spatial search. Replaces the old
        # 100m findMatchedIaqFeature scan that produced wrong answers
        # when two parcels were within 100m of each other.
        cf['properties']['iaq_match_lon']    = ig[0]
        cf['properties']['iaq_match_lat']    = ig[1]
        iaq_f['properties']['iaq_matched'] = True
        upgraded += 1
    return upgraded


def _apply_iaq_to_field_features(field_features: list, iaq_features: list,
                                  parcel_idx: "ParcelIndex | None" = None,
                                  fallback_m: float = 30) -> int:
    """
    Upgrade field survey point status to Completed when an IAQ survey
    exists for the same parcel.

    v3 algorithm (2026-05-05) — parcel-centred, GPS-aware:

      1. **Same-parcel match (preferred):** snap the field pin's
         door-GPS to its parcel rep-point via parcel_idx.snap(). Look
         up an IAQ feature whose coords equal that rep-point (within
         1 m). Same parcel = same household.

      2. **Distance fallback (`fallback_m`, default 30 m):** when a
         parcel index isn't provided OR the field pin is outside any
         parcel (curb-side reading, GPS error). Conservative threshold
         — 30 m ≈ one suburban lot frontage, won't cross property
         lines in normal cases.

    Returns the count of field points upgraded.
    """
    if not iaq_features:
        return 0
    upgraded = 0
    for ff in field_features:
        if ff['properties'].get('status') == 'Completed':
            continue
        f_lon, f_lat = ff['geometry']['coordinates']
        match_iaq = None

        # Tier 1: parcel-snap the field pin, look up matching IAQ.
        if parcel_idx is not None:
            f_parcel = parcel_idx.parcel_rep_point(f_lon, f_lat, max_dist_m=50)
            if f_parcel is not None:
                p_lon, p_lat = f_parcel
                for iaq_f in iaq_features:
                    i_lon, i_lat = iaq_f['geometry']['coordinates']
                    if _haversine_m(p_lat, p_lon, i_lat, i_lon) <= 1.0:
                        match_iaq = iaq_f
                        break

        # Tier 2: conservative distance fallback (no parcel context).
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
    return upgraded


# ── Analysis stats (identical to app.py) ──────────────────────────────────────

def _compute_iaq_analysis(features: list) -> dict:
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
    htypes: dict = defaultdict(int)
    for p in props:
        ht = str(p.get('housing_type', '') or '').lower()
        if 'single wide' in ht:         htypes['Single Wide'] += 1
        elif 'double wide' in ht:        htypes['Double Wide'] += 1
        elif 'site' in ht and 'built' in ht: htypes['Site Built'] += 1
        else:                            htypes['Other'] += 1
    conds: dict = defaultdict(int)
    for p in props:
        c = str(p.get('condition', '') or '').lower()
        if 'good' in c:   conds['Good'] += 1
        elif 'fair' in c: conds['Fair'] += 1
        elif 'poor' in c: conds['Poor'] += 1
        else:             conds['Unknown'] += 1
    yr_dist: dict = defaultdict(int)
    for p in props:
        y = str(p.get('year_built', '') or '').lower()
        if 'before 1960' in y:  yr_dist['Before 1960'] += 1
        elif '1960' in y:        yr_dist['1960–1979'] += 1
        elif '1980' in y:        yr_dist['1980–1999'] += 1
        elif '2000' in y:        yr_dist['2000+'] += 1
        else:                    yr_dist['Unknown'] += 1
    owners  = sum(1 for p in props if p.get('ownership') == 'Owner')
    renters = sum(1 for p in props if p.get('ownership') == 'Renter')

    # ── New survey-question aggregations (R/C/W/D blocks) ─────────────────────
    def _bin_counts(field):
        """Count distinct non-empty stripped values; returns {value: count}."""
        c: dict = defaultdict(int)
        for p in props:
            v = str(p.get(field, '') or '').strip()
            if v:
                c[v] += 1
        return dict(c)

    def _yes_no_counts(field):
        """Normalize Yes/No/Not Sure (case-insensitive) into a fixed-shape dict.
        Anything else non-empty → 'other'; empty → 'na'."""
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

    # Token sets used by _pct_yes / _pct_want. Real Qualtrics matrix
    # answers in the production export use a mix of literal yes/no,
    # frequency words (Daily / Weekly / Biweekly / Monthly / Yearly /
    # Never), and Likert-positive phrasings ("Strongly want", "Somewhat
    # want", "Strongly agree"), so the predicates have to recognise all
    # three forms or every Community / Experiences chart renders 0%.
    # Order matters: NEGATIVE first (so "not interested" / "I don't want"
    # / "Strongly disagree" / "Never" short-circuit before the positive
    # patterns trigger on any embedded substring).
    _NEGATIVE_TOKENS = (
        'not ', "don't", 'do not', 'never', 'no - ', 'no, ',
        'strongly disagree', 'somewhat disagree', 'disagree',
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

    def _is_negative(v: str) -> bool:
        return any(t in v for t in _NEGATIVE_TOKENS)

    def _pct_yes(field):
        """Percentage of respondents who reported they have experienced
        this. Recognises:
          - explicit 'yes' / 'agree' / 'true'
          - frequency words (Daily/Weekly/Biweekly/Monthly/Yearly/etc.)
            — having an experience at any frequency counts as "yes".
        Negative answers (no/never/disagree/not/don't) short-circuit
        regardless of any positive token they happen to contain."""
        if not n:
            return 0.0
        hits = 0
        for p in props:
            v = str(p.get(field, '') or '').lower().strip()
            if not v:
                continue
            if _is_negative(v):
                continue
            if any(t in v for t in _AFFIRM_TOKENS):
                hits += 1
                continue
            if any(t in v for t in _FREQUENCY_TOKENS):
                hits += 1
        return round(hits / n * 100, 1)

    def _pct_want(field):
        """Percentage of respondents who want / would like / agree with
        an intervention. Recognises:
          - 'want' / 'would like' / 'yes' / 'agree' / 'true'
          - Likert positives ('strongly', 'somewhat', 'definitely',
            'interested')
        Negative phrases short-circuit before the positive scan."""
        if not n:
            return 0.0
        hits = 0
        for p in props:
            v = str(p.get(field, '') or '').lower().strip()
            if not v:
                continue
            if _is_negative(v):
                continue
            if any(t in v for t in _POSITIVE_WANT_TOKENS):
                hits += 1
        return round(hits / n * 100, 1)

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
        'n_responses': n, 'geocoded': n,
        'scores': {
            'mean_risk':   _mean(risks),
            'mean_health': _mean([p['health_score'] for p in props]),
            'mean_iaq':    _mean([p['iaq_score']    for p in props]),
            'mean_struct': _mean([p['struct_score']  for p in props]),
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
        'survey_questions': {f: q for f, (_, q) in SURVEY_QUESTIONS.items()},
        'chart_sources':    dict(CHART_SOURCES),
    }


def _compute_street_stats(features: list) -> dict:
    grouped: dict = defaultdict(list)
    for f in features:
        grouped[f['properties']['street_name']].append(f['properties'])
    stats: dict = {}
    ranked: list = []
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

        htypes: dict = defaultdict(int)
        for p in props:
            ht = str(p.get('housing_type', '') or '').lower()
            if 'single wide' in ht:       htypes['single_wide'] += 1
            elif 'double wide' in ht:      htypes['double_wide'] += 1
            elif 'site' in ht:             htypes['site_built'] += 1
            else:                          htypes['other'] += 1
        mean_risk = _m('overall_risk')
        entry = {
            'n': n, 'mean_risk': mean_risk,
            'mean_health': _m('health_score'), 'mean_iaq': _m('iaq_score'),
            'mean_struct': _m('struct_score'),
            'pct_mold': round(sum(1 for p in props if p.get('has_mold')) / n * 100, 1),
            'pct_respiratory': _pct_active('respiratory_ill'),
            'pct_asthma':      _pct_active('asthma_freq'),
            'pct_hospital': round(
                sum(1 for p in props if p.get('hospital_visit') == 'yes') / n * 100, 1),
            'housing_types': dict(htypes),
            'owner_count':  sum(1 for p in props if p.get('ownership') == 'Owner'),
            'renter_count': sum(1 for p in props if p.get('ownership') == 'Renter'),
        }
        stats[street] = entry
        ranked.append((street, mean_risk))
    ranked.sort(key=lambda x: -x[1])
    for rank, (street, _) in enumerate(ranked, 1):
        stats[street]['risk_rank'] = rank
    return stats


# ── Community contact status categorization (identical to app.py) ─────────────

def categorize(text) -> str:
    if not text or _isna(text):
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
    if any(k in t for k in ["gated", "locked", "inaccessible", "no trespass",
                             "beware of dog", "big dog", "dog", "gun sign", "fire arms",
                             "rebel flag", "nt sign", "fire station", "warning sign",
                             "no respassing"]):
        return "Inaccessible"
    if any(k in t for k in ["not interested", "declined", "doesn't want", "no interest"]):
        return "Not Interested"
    if any(k in t for k in ["flier", "flyer", "qr code"]):
        return "Left Info"
    if any(k in t for k in ["vacant", "for sale", "unoccupied", "empty", "no house",
                             "uninhabited", "uninhabitat", "under construction",
                             "no one lives", "padlocked", "boarded", "side road",
                             "didn't visit"]):
        return "Vacant"
    if any(k in t for k in ["come back", "will complete", "interested", "plans to",
                             "wants survey", "no time", "busy", "later", "contact on",
                             "may do survey", "started completing"]):
        return "Follow Up"
    return "Other"


# ── Main processing functions ──────────────────────────────────────────────────

def _read_qualtric_csv(file_bytes: bytes) -> pd.DataFrame:
    """
    Read a Qualtric CSV with encoding auto-detection and tolerant header handling.

    Qualtric standard exports include two extra rows under the header
    (question-text row + JSON metadata row containing 'ImportId').
    Some "legacy CSV" exports omit them. Detect rather than assume.
    """
    if not file_bytes:
        raise ValueError("Empty CSV body — no bytes received.")

    # Strip leading UTF-8 BOM if present (idempotent across encodings).
    if file_bytes[:3] == b'\xef\xbb\xbf':
        file_bytes = file_bytes[3:]

    encodings = ('utf-8-sig', 'utf-8', 'utf-16', 'cp1252', 'latin-1')
    last_err: Exception | None = None
    head: pd.DataFrame | None = None
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

    skip: list[int] = []
    row2_has_importid = (
        len(head) > 2
        and 'ImportId' in ' '.join(str(v) for v in head.iloc[2].tolist())
    )
    if len(head) > 1:
        row1 = ' '.join(str(v) for v in head.iloc[1].tolist())
        # Qualtric convention: when row 2 carries ImportId metadata, row 1 is
        # always the question-text row regardless of length.
        if row2_has_importid or 'ImportId' in row1 or any(
            len(str(v)) > 40 for v in head.iloc[1].tolist()
        ):
            skip.append(1)
    if row2_has_importid:
        skip.append(2)

    raw = pd.read_csv(io.BytesIO(file_bytes), encoding=used_enc,
                      skiprows=skip, low_memory=False) if skip else \
          pd.read_csv(io.BytesIO(file_bytes), encoding=used_enc, low_memory=False)
    logging.info("[iaq] csv decoded enc=%s skip=%s rows=%d cols=%d",
                 used_enc, skip, len(raw), len(raw.columns))
    return raw


def process_iaq_bytes(csv_bytes: bytes, contact_features: list,
                      parcel_idx: ParcelIndex) -> tuple:
    """
    Process a Qualtric IAQ CSV and return (geojson, analysis, street_stats, n_upgraded).

    Identical to app.py's process_iaq_survey() — same scores, same geocoding
    (GPS → parcel snap → address match → Census), same IAQ↔contact matching.
    contact_features is mutated in-place (statuses upgraded to Completed).
    raw_address is NOT included in the returned geojson (stripped before return).
    """
    raw = _read_qualtric_csv(csv_bytes)

    if 'Finished' not in raw.columns:
        raise ValueError(
            "CSV is missing the 'Finished' column. "
            "Re-export: Qualtrics → Data → Export & Import → Export Data → CSV."
        )

    missing_columns = _validate_iaq_columns(raw.columns)
    if missing_columns:
        print(f"[iaq] WARN missing columns: {missing_columns}")

    _fin = raw['Finished'].astype(str).str.strip().str.lower()
    _mask = _fin.isin(['true', '1'])
    # df_full keeps every column (incl. PII + blank/duplicate-named matrix
    # columns) so we can index by ORIGINAL CSV position for SURVEY_QUESTIONS.
    # df strips PII columns and is what existing name-based code reads.
    df_full = raw[_mask].copy().reset_index(drop=True)
    df = df_full.copy()
    if df.empty:
        # Log diagnostic Finished-column values to Vercel runtime; do NOT
        # echo CSV cell values back to the HTTP client (avoid PII reflection).
        print(f"[iaq] empty-after-Finished filter — sample values: "
              f"{list(raw['Finished'].astype(str).unique()[:8])}")
        raise ValueError(
            "No completed responses found in the CSV. "
            "Only rows where Finished='True' or Finished=1 are processed."
        )

    df.drop(columns=[c for c in PII_COLS if c in df.columns], inplace=True)

    contact_lookup = _build_contact_lookup(contact_features)
    known_streets  = _build_known_streets(contact_lookup)

    features: list = []
    failed_geocodes: list = []
    for i, (_, row) in enumerate(df.iterrows()):
        # Extract survey-question fields by ORIGINAL CSV column index from
        # the pre-PII-drop row; matches indices in SURVEY_QUESTIONS.
        survey_extras = _extract_survey_extras(df_full.iloc[i])
        health = _compute_health_score(row)
        iaq    = _compute_iaq_score(row)
        struct = _compute_struct_score(row)
        risk   = round(0.35 * health + 0.35 * iaq + 0.30 * struct)
        tier   = 'Low' if risk < 34 else ('Medium' if risk < 67 else 'High')
        tier_color = '#10b981' if tier == 'Low' else ('#f97316' if tier == 'Medium' else '#ef4444')

        q212 = row.get('Q212', '')
        street_name = _extract_street_name(q212) or 'Unknown'
        street_name = _canonicalize_street(street_name, known_streets)

        # ── ADDRESS-ONLY GEOCODING (v3, 2026-05-05) ───────────────────
        # The Qualtrics LocationLatitude / LocationLongitude is *where
        # the respondent submitted the survey*, NOT necessarily their
        # home: respondents fill from kitchen tables, community centres,
        # work, friends' houses — anywhere with cell signal. Treating it
        # as the household coord caused systematic mis-matching against
        # community contacts.
        #
        # Both community contacts and IAQ are now reduced to the same
        # canonical form: parcel rep-point of the typed address (Q212).
        # Match becomes deterministic parcel-coord equality, not radius.
        #
        # Branches, in priority order:
        #   1. Q212 matches an existing contact's geocoded coord →
        #      'address_matched' (uses the contact's already-snapped
        #      parcel rep-point — guaranteed identical for tier-3 match).
        #   2. parcel_idx.geocode(Q212) — runs the same 4-tier path that
        #      community contacts go through (parcel_exact / parcel_fuzzy
        #      / Census API + parcel_snap / Census-only).
        #   3. None of the above → drop. Logged. Most likely a flyer
        #      respondent who left Q212 blank or typed something we
        #      can't parse. Better to drop than to attach to a random
        #      nearby parcel by GPS.
        coords = None
        coord_source = 'none'
        q212_str = ' '.join(str(q212).split()) if q212 else ''
        if q212_str and q212_str.lower() not in ('', 'ttt', 'nan', 'read to respondent'):
            lng_m, lat_m, matched_addr, _ = _address_match(q212_str, contact_lookup)
            if lng_m is not None:
                coords = [round(float(lng_m), 6), round(float(lat_m), 6)]
                coord_source = 'address_matched'
                street_name = _extract_street_name(matched_addr) or street_name
            else:
                lng_g, lat_g, matched, gsrc = parcel_idx.geocode(q212_str)
                if lng_g is not None:
                    coords = [round(float(lng_g), 6), round(float(lat_g), 6)]
                    coord_source = gsrc
                    if street_name == 'Unknown':
                        street_name = _extract_street_name(matched or '') or 'Unknown'

        if coords is None:
            addr_str = q212_str
            print(f"[geocode] FAILED iaq (no Q212 / unparseable): '{addr_str[:80]}'")
            failed_geocodes.append(addr_str[:200])
            continue

        mold_val = row.get('Mold')
        has_mold = bool(mold_val and not _isna(mold_val) and
                        str(mold_val).strip() not in ('', 'nan'))
        ow_raw   = str(row.get('Ownership', '') or '').lower()
        ownership = 'Owner' if 'owner' in ow_raw else ('Renter' if 'renter' in ow_raw else 'Other')
        raw_addr  = ' '.join(str(q212).split()) if q212 and str(q212).strip().lower() not in (
            '', 'ttt', 'nan', 'read to respondent') else ''

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
                'respiratory_ill': str(row.get('RespIll', '')  or ''),
                'asthma_freq':     str(row.get('asthma', '')   or ''),
                'wheeze_freq':     str(row.get('wheeze', '')   or ''),
                'headache_freq':   str(row.get('Headache', '') or ''),
                'hospital_visit':  ('yes' if 'yes' in str(
                    row.get('Hospital Respiratory', '') or '').lower() else 'no'),
                'coord_source':    coord_source,
                'raw_address':     raw_addr,
                'iaq_matched':     False,
                **survey_extras,
            },
        })

    # Match IAQ features → community contacts, upgrade statuses
    n_upgraded = 0
    if contact_features and features:
        matches = _match_iaq_to_contacts(features, contact_features)
        n_upgraded = _upgrade_contacts_from_iaq(contact_features, features, matches)

    # Tag every IAQ feature with its match_status group so the desktop
    # dashboard can render a stroke colour per group (G1=matched white,
    # G2=contact_only amber, G3=iaq_only purple). The contact side gets
    # its match_status set during the next call to _tag_contact_match_status
    # in upload.py, after the upgrade pass mutates has_iaq_survey.
    for f in features:
        f['properties']['match_status'] = (
            'matched' if f['properties'].get('iaq_matched') else 'iaq_only'
        )

    # Strip PII (raw_address) before returning / persisting
    for f in features:
        f['properties'].pop('raw_address', None)

    # Per-respondent SURVEY_QUESTIONS answers are RETAINED on each IAQ feature
    # so the dashboard's contact-point popup can render a "Survey Answers" tab
    # by spatial-matching the clicked contact to its IAQ feature in iaqData.
    # The numeric helper years_in_hre_num is dropped (analysis-only).
    analysis = _compute_iaq_analysis(features)
    for f in features:
        f['properties'].pop('years_in_hre_num', None)
    geojson = {'type': 'FeatureCollection', 'features': features}
    if missing_columns:
        analysis['validation_warnings'] = {
            'missing_columns': missing_columns,
            'message': (
                'Some expected Qualtrics columns are missing — affected scores '
                'default to 0. Verify the export format.'
            ),
        }
    streets  = _compute_street_stats(features)
    return geojson, analysis, streets, n_upgraded, failed_geocodes


def compute_contact_analysis(contact_features: list) -> dict:
    """
    Compute contact-level analysis stats from a feature list.
    Matches the shape of app.py's compute_analysis() output so the
    dashboard's GET /api/analysis reads correct data after a Vercel upload.
    Parcel stats are omitted (parcel data is loaded separately by the browser).
    """
    sc: dict = {}
    for f in contact_features:
        s = f['properties'].get('status', 'Unknown')
        sc[s] = sc.get(s, 0) + 1

    st_count: dict = {}
    st_status: dict = {}
    for f in contact_features:
        sn = f['properties'].get('street_name', 'Unknown')
        s  = f['properties'].get('status', 'Unknown')
        st_count[sn] = st_count.get(sn, 0) + 1
        st_status.setdefault(sn, {})[s] = st_status.get(sn, {}).get(s, 0) + 1

    total = len(contact_features)
    comp  = sc.get('Completed', 0)
    return {
        'total_points':    total,
        'completion_rate': round(comp / total * 100, 1) if total else 0,
        'status_counts':   sc,
        'status_colors':   STATUS,
        'streets': [
            {'name': n, 'count': c, 'statuses': st_status.get(n, {})}
            for n, c in sorted(st_count.items(), key=lambda x: -x[1])
        ],
        'parcel_stats': {},
    }


def process_survey_bytes(file_bytes: bytes, filename: str,
                         parcel_idx: ParcelIndex) -> dict:
    """
    Geocode community survey contact addresses from an Excel or CSV file.
    Returns GeoJSON FeatureCollection — identical to app.py's process_survey().
    """
    suf = Path(filename).suffix.lower()
    df = pd.read_csv(io.BytesIO(file_bytes)) if suf == '.csv' else \
         pd.read_excel(io.BytesIO(file_bytes))

    features: list = []
    failed_geocodes: list = []
    for i, row in df.iterrows():
        addr   = str(row.get('Address', '') or '').strip()
        if not addr or addr.lower() == 'nan':
            continue
        detail = str(row.get('First attempt', '') or '')
        status = categorize(detail)
        second = str(row.get('Second attempt', '')) if pd.notna(row.get('Second attempt')) else ''
        notes  = str(row.get('Other notes: ', '')) if pd.notna(row.get('Other notes: ')) else ''
        dt = ''
        if pd.notna(row.get('date')):
            try:    dt = str(row['date'].date())
            except: dt = str(row['date'])

        street = _extract_street_name(addr) or addr
        lng, lat, matched, geo_src = parcel_idx.geocode(addr)

        if lng and lat:
            features.append({
                'type': 'Feature',
                'geometry': {'type': 'Point', 'coordinates': [round(lng, 6), round(lat, 6)]},
                'properties': {
                    'id': int(i), 'address': addr, 'status': status,
                    'status_detail': detail, 'second_attempt': second,
                    'date': dt, 'notes': notes, 'street_name': street,
                    'matched_address': matched or '',
                    'coord_source': geo_src,
                    'color': STATUS.get(status, '#9ca3af'),
                },
            })
        else:
            print(f"[geocode] FAILED survey: '{addr[:80]}'")
            failed_geocodes.append(addr[:200])

    return {'type': 'FeatureCollection', 'features': features}, failed_geocodes
