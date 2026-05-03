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

    def snap(self, lon: float, lat: float, max_dist_m: float = 150) -> tuple | None:
        """Find nearest parcel representative_point within max_dist_m m.
        Returns (lon, lat) inside the parcel, or None."""
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
    mold = row.get('Mold')
    if mold and not _isna(mold) and str(mold).strip() not in ('', 'nan'):
        score += 30
    for col in ['Leakage 2_1', 'Leakage 2_2', 'Leakage 2_3', 'Leakage 2_4']:
        val = str(row.get(col, '') or '').lower().strip()
        if val and val not in ('none', 'nan', ''):
            score += 7.5
    for col in ['Cooling System\xa0_1', 'Cooling System\xa0_2',
                'Cooling System\xa0_3', 'Cooling System\xa0_4']:
        val = str(row.get(col, '') or '').lower()
        if 'more than 15' in val:
            score += 4
        elif "don't know" in val or 'not applicable' in val:
            score += 2
    if any(kw in str(row.get('Cooking ', '') or '').lower() for kw in ('gas', 'propane')):
        score += 10
    return round(min(score, 100))


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
                            threshold_m: float = 50) -> dict:
    addr_lookup: dict = {}
    by_house: dict = {}
    for ci, cf in enumerate(contact_features):
        addr = cf['properties'].get('address', '')
        parsed = _parse_addr_parts(addr)
        if parsed:
            h, c = parsed
            addr_lookup[(h, c)] = ci
            by_house.setdefault(h, []).append((c, ci))
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
            best_d, best_ci = float('inf'), None
            for ci, cf in enumerate(contact_features):
                if ci in used_contacts:
                    continue
                c_lon, c_lat = cf['geometry']['coordinates']
                d = _haversine_m(iaq_lat, iaq_lon, c_lat, c_lon)
                if d < best_d:
                    best_d, best_ci = d, ci
            if best_d <= threshold_m and best_ci is not None:
                matched_ci = best_ci
        if matched_ci is not None:
            matches[ii] = matched_ci
            used_contacts.add(matched_ci)
    return matches


def _upgrade_contacts_from_iaq(survey_feats: list, iaq_features: list,
                                matches: dict) -> int:
    upgraded = 0
    for iaq_idx, contact_idx in matches.items():
        cf = survey_feats[contact_idx]
        iaq_f = iaq_features[iaq_idx]
        ip = iaq_f['properties']
        cf['properties']['status']           = 'Completed'
        cf['properties']['color']            = STATUS['Completed']
        cf['properties']['has_iaq_survey']   = True
        cf['properties']['iaq_overall_risk'] = ip.get('overall_risk', 0)
        cf['properties']['iaq_risk_tier']    = ip.get('risk_tier', '')
        cf['properties']['iaq_health_score'] = ip.get('health_score', 0)
        cf['properties']['iaq_iaq_score']    = ip.get('iaq_score', 0)
        cf['properties']['iaq_struct_score'] = ip.get('struct_score', 0)
        iaq_f['properties']['iaq_matched'] = True
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

def process_iaq_bytes(csv_bytes: bytes, contact_features: list,
                      parcel_idx: ParcelIndex) -> tuple:
    """
    Process a Qualtric IAQ CSV and return (geojson, analysis, street_stats, n_upgraded).

    Identical to app.py's process_iaq_survey() — same scores, same geocoding
    (GPS → parcel snap → address match → Census), same IAQ↔contact matching.
    contact_features is mutated in-place (statuses upgraded to Completed).
    raw_address is NOT included in the returned geojson (stripped before return).
    """
    raw = pd.read_csv(io.BytesIO(csv_bytes), skiprows=[1, 2], low_memory=False)
    df = raw[raw['Finished'].astype(str).str.lower() == 'true'].copy().reset_index(drop=True)

    df.drop(columns=[c for c in PII_COLS if c in df.columns], inplace=True)

    contact_lookup = _build_contact_lookup(contact_features)
    known_streets  = _build_known_streets(contact_lookup)

    features: list = []
    for _, row in df.iterrows():
        health = _compute_health_score(row)
        iaq    = _compute_iaq_score(row)
        struct = _compute_struct_score(row)
        risk   = round(0.35 * health + 0.35 * iaq + 0.30 * struct)
        tier   = 'Low' if risk < 34 else ('Medium' if risk < 67 else 'High')
        tier_color = '#10b981' if tier == 'Low' else ('#f97316' if tier == 'Medium' else '#ef4444')

        q212 = row.get('Q212', '')
        street_name = _extract_street_name(q212) or 'Unknown'
        street_name = _canonicalize_street(street_name, known_streets)

        lat_q = pd.to_numeric(row.get('LocationLatitude'),  errors='coerce')
        lon_q = pd.to_numeric(row.get('LocationLongitude'), errors='coerce')
        coord_source = 'gps'
        coords = None

        if (pd.notna(lat_q) and pd.notna(lon_q) and
                KH_LAT_MIN <= float(lat_q) <= KH_LAT_MAX and
                KH_LON_MIN <= float(lon_q) <= KH_LON_MAX):
            coords = [round(float(lon_q), 6), round(float(lat_q), 6)]
            snapped = parcel_idx.snap(float(lon_q), float(lat_q), max_dist_m=80)
            if snapped:
                coords = [round(snapped[0], 6), round(snapped[1], 6)]
                coord_source = 'gps_snapped'
        else:
            q212_str = ' '.join(str(q212).split()) if q212 else ''
            if q212_str and q212_str.lower() not in ('', 'ttt', 'nan', 'read to respondent'):
                lng_m, lat_m, matched_addr, _ = _address_match(q212_str, contact_lookup)
                if lng_m is not None:
                    coords = [round(float(lng_m), 6), round(float(lat_m), 6)]
                    coord_source = 'address_matched'
                    street_name = _extract_street_name(matched_addr) or street_name
                else:
                    lng_g, lat_g, matched, gsrc = parcel_idx.geocode(q212_str)
                    coord_source = gsrc
                    if lng_g is not None:
                        coords = [round(float(lng_g), 6), round(float(lat_g), 6)]
                        if street_name == 'Unknown':
                            street_name = _extract_street_name(matched or '') or 'Unknown'

        if coords is None:
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
            },
        })

    # Match IAQ features → community contacts, upgrade statuses
    n_upgraded = 0
    if contact_features and features:
        matches = _match_iaq_to_contacts(features, contact_features)
        n_upgraded = _upgrade_contacts_from_iaq(contact_features, features, matches)

    # Strip PII (raw_address) before returning / persisting
    for f in features:
        f['properties'].pop('raw_address', None)

    geojson  = {'type': 'FeatureCollection', 'features': features}
    analysis = _compute_iaq_analysis(features)
    streets  = _compute_street_stats(features)
    return geojson, analysis, streets, n_upgraded


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
    for i, row in df.iterrows():
        addr   = str(row.get('Address', '') or '').strip()
        if not addr or addr.lower() == 'nan':
            continue
        detail = str(row['First attempt']) if pd.notna(row.get('First attempt')) else ''
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

    return {'type': 'FeatureCollection', 'features': features}
