"""Lightweight survey logic helpers (no pandas/shapely dependencies)."""

from __future__ import annotations

from collections import defaultdict
from math import radians, sin, cos, sqrt, atan2


QID141_RECODE_LABELS = {
    "1": "Excellent- No repairs needed.",
    "2": "Good- Minor repairs needed.",
    "3": "Fair- Some repairs needed.",
    "4": "Poor- Major repairs needed.",
    "5": "Critical- Uninhabitable without repairs.",
}


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * r * atan2(sqrt(a), sqrt(1 - a))


def compute_struct_score(parts: dict) -> int:
    score = 0
    yr = str(parts.get("QID192", "") or "").lower()
    if "before 1960" in yr:
        score += 30
    elif "1960" in yr:
        score += 20
    elif "1980" in yr:
        score += 10

    ht = str(parts.get("QID128", "") or "").lower()
    if "single wide" in ht:
        score += 25
    elif "double wide" in ht:
        score += 15
    elif "non-traditional" in ht or "camper" in ht:
        score += 20

    cond_raw = parts.get("QID141", "")
    cond = str(cond_raw or "").lower()
    if "critical" in cond or "uninhabitable" in cond:
        score += 35
    elif "poor" in cond:
        score += 25
    elif "fair" in cond:
        score += 15
    else:
        try:
            cnum = float(str(cond_raw).strip())
        except (TypeError, ValueError):
            cnum = None
        if cnum is not None:
            if cnum >= 5:
                score += 35
            elif cnum >= 4:
                score += 25
            elif cnum >= 3:
                score += 15

    return round(min(score, 100))


def symptom_frequency_score(val) -> int:
    """Map symptom frequency text to 0–4 for the health vulnerability composite.

    Numeric Qualtrics exports are recoded to labels like ``annually``; that word
    does not contain ``year``, so ``annual`` is matched explicitly alongside
    ``year`` (e.g. ``once per year``).
    """
    if val is None:
        return 0
    try:
        if isinstance(val, float) and val != val:  # NaN
            return 0
    except Exception:
        pass
    try:
        v = str(val).strip().lower()
    except Exception:
        return 0
    if not v or v in ("nan", "none", "nat"):
        return 0
    if "weekly" in v:
        return 4
    if "month" in v:
        return 3
    if "season" in v:
        return 2
    if "year" in v or "annual" in v:
        return 1
    return 0


def nearest_contact_distance_m(iaq_lon: float, iaq_lat: float, contact_features: list) -> float | None:
    best = None
    for cf in contact_features:
        try:
            c_lon, c_lat = cf["geometry"]["coordinates"]
            d = haversine_m(iaq_lat, iaq_lon, float(c_lat), float(c_lon))
        except Exception:
            continue
        if best is None or d < best:
            best = d
    return round(best, 1) if best is not None else None


def build_validation_summary(iaq_features: list, contact_features: list) -> dict:
    match_details = []
    unmatched_by_street: dict = defaultdict(int)

    for f in iaq_features:
        props = f.get("properties") or {}
        coords = (f.get("geometry") or {}).get("coordinates") or [None, None]
        lon, lat = coords[0], coords[1]
        matched = bool(props.get("iaq_matched"))
        street = props.get("street_name") or "Unknown"
        coord_source = props.get("coord_source") or "unknown"

        nearest = None
        if lon is not None and lat is not None and not matched:
            nearest = nearest_contact_distance_m(float(lon), float(lat), contact_features)
            unmatched_by_street[street] += 1

        match_details.append(
            {
                "street_name": street,
                "coord_source": coord_source,
                "matched": matched,
                "nearest_contact_m": nearest,
            }
        )

    total_iaq = len(iaq_features)
    total_completed_contacts = sum(
        1 for cf in contact_features if (cf.get("properties") or {}).get("status") == "Completed"
    )
    matched_iaq = sum(1 for d in match_details if d.get("matched"))
    unmatched_iaq = max(total_iaq - matched_iaq, 0)
    # % of IAQ surveys matched to a completed contact (same parcel).
    match_rate = round((matched_iaq / total_iaq) * 100, 1) if total_iaq else 0.0
    # % of completed canvass contacts that have at least one confirmed IAQ pairing
    # (same numerator; denominator from community layer — mirrors app.py coverage_pct).
    coverage_pct = (
        round((matched_iaq / total_completed_contacts) * 100, 1) if total_completed_contacts else 0.0
    )

    return {
        "total_iaq_responses": total_iaq,
        "total_completed_contacts": total_completed_contacts,
        "matched_iaq_responses": matched_iaq,
        "unmatched_iaq": unmatched_iaq,
        "match_rate_pct": match_rate,
        "coverage_pct": coverage_pct,
        "match_details": match_details,
        "unmatched_by_street": dict(unmatched_by_street),
    }
