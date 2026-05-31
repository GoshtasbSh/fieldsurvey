"""
V2 Segregation & Diversity Indices
====================================
Five established indices from Massey & Denton (1988) taxonomy + Shannon entropy.

Indices computed
----------------
D   — Dissimilarity Index (binary evenness): 0=integrated, 1=fully segregated
xPx — Isolation Index (exposure): probability of same-group contact
xPy — Interaction Index (exposure): probability of cross-group contact
H   — Entropy Index (multigroup evenness): area-weighted information divergence
G   — Spatial Gini (inequality): 0=equal zone shares, 1=all in one zone

Algorithm
---------
1. Assign each geocoded response point to a grid zone (cell_deg × cell_deg).
2. Tally group membership per zone using the selected categorical question.
3. Compute the five indices from zone contingency tables.
4. Classify D: low (<0.3) / moderate (0.3–0.6) / high (≥0.6).
5. Return per-zone composition for map overlay.

References
----------
Massey & Denton (1988) "The Dimensions of Residential Segregation"
Reardon & Firebaugh (2002) "Measures of Multigroup Segregation"
Iceland, Weinberg & Steinmetz (2002) Racial and Ethnic Residential Segregation
"""
from __future__ import annotations

import math
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from ..lib.cache import write_cache

router = APIRouter()


def _zone_key(lat: float, lon: float, cell_deg: float) -> tuple[int, int]:
    return (int(math.floor(lat / cell_deg)), int(math.floor(lon / cell_deg)))


def _entropy_bits(props: list[float]) -> float:
    """Shannon entropy H = -Σ p·ln(p) in nats. 0 for pure zones."""
    h = 0.0
    for p in props:
        if p > 1e-12:
            h -= p * math.log(p)
    return h


def compute(
    rows: list[dict],
    group_key: str = "group_value",
    zone_size_deg: float = 0.1,
) -> dict:
    """
    rows: [{id, lat, lon, group_value}]
    Returns: five segregation indices + per-zone composition table.
    """
    # Filter valid rows
    valid = [r for r in rows if r.get("lat") and r.get("lon") and r.get("group_value") is not None]
    n = len(valid)

    if n < 20:
        return {
            "error": "insufficient_data",
            "n": n,
            "message": f"Need ≥20 geocoded responses with a group answer; found {n}.",
        }

    all_groups = sorted(set(str(r["group_value"]) for r in valid))
    if len(all_groups) < 2:
        return {
            "error": "need_at_least_2_groups",
            "n_groups": len(all_groups),
            "message": "The selected question must have ≥2 distinct answer options.",
        }

    # Overall totals
    group_totals = {g: sum(1 for r in valid if str(r["group_value"]) == g) for g in all_groups}
    group_props = {g: group_totals[g] / n for g in all_groups}

    # Assign zones
    for r in valid:
        r["_zone"] = _zone_key(r["lat"], r["lon"], zone_size_deg)

    zone_ids = sorted(set(r["_zone"] for r in valid))
    n_zones = len(zone_ids)

    # Build zone → group contingency table
    zone_counts: dict[tuple, dict[str, int]] = {}
    zone_coords: dict[tuple, list] = {}
    for r in valid:
        zid = r["_zone"]
        if zid not in zone_counts:
            zone_counts[zid] = {g: 0 for g in all_groups}
            zone_coords[zid] = []
        zone_counts[zid][str(r["group_value"])] += 1
        zone_coords[zid].append((r["lat"], r["lon"]))

    # Majority / minority groups (by total count; secondary sort by label ensures they differ)
    sorted_by_count = sorted(all_groups, key=lambda g: (-group_totals[g], g))
    majority_group = sorted_by_count[0]   # largest (or first alphabetically if tied)
    minority_group = sorted_by_count[-1]  # smallest (or last alphabetically if tied)
    A = group_totals[majority_group]   # majority count
    B = group_totals[minority_group]   # minority count

    # ── Dissimilarity Index (D) ──────────────────────────────────────────────
    # D = 0.5 × Σ |ai/A − bi/B|   (binary, majority vs. rest)
    D = 0.0
    B_all = n - A   # non-majority total
    if A > 0 and B_all > 0:
        for zid in zone_ids:
            ai = zone_counts[zid].get(majority_group, 0)
            bi = zone_counts[zid].get(minority_group, 0)
            # Use majority vs minority binary version
            D += abs(ai / A - bi / B) if B > 0 else 0.0
    D = float(0.5 * D)

    # ── Isolation Index P*aa ─────────────────────────────────────────────────
    # P*aa = Σ (ai/A) × (ai/ti)
    # Probability a majority member's zone-mate is also majority
    P_isolation = 0.0
    if A > 0:
        for zid in zone_ids:
            ai = zone_counts[zid].get(majority_group, 0)
            ti = sum(zone_counts[zid].values())
            if ti > 0:
                P_isolation += (ai / A) * (ai / ti)

    # ── Interaction Index P*ab ───────────────────────────────────────────────
    # P*ab = Σ (ai/A) × (bi/ti)
    # Probability a majority member encounters a minority member
    P_interaction = 0.0
    if A > 0:
        for zid in zone_ids:
            ai = zone_counts[zid].get(majority_group, 0)
            bi = zone_counts[zid].get(minority_group, 0)
            ti = sum(zone_counts[zid].values())
            if ti > 0:
                P_interaction += (ai / A) * (bi / ti)

    # ── Entropy Index (H) ────────────────────────────────────────────────────
    # Regional entropy: E = -Σ πg·ln(πg)
    # Zone entropy: Ei = -Σ pij·ln(pij)
    # H = Σ (ti/T) × (E − Ei) / E   (Reardon & Firebaugh 2002)
    E_overall = _entropy_bits(list(group_props.values()))
    H_entropy = 0.0
    if E_overall > 1e-12:
        for zid in zone_ids:
            ti = sum(zone_counts[zid].values())
            zprops = [zone_counts[zid].get(g, 0) / ti for g in all_groups]
            Ei = _entropy_bits(zprops)
            H_entropy += (ti / n) * (E_overall - Ei) / E_overall

    # ── Spatial Gini ─────────────────────────────────────────────────────────
    # Gini of majority-group zone proportions: inequality of majority share
    majority_zone_props = sorted([
        zone_counts[zid].get(majority_group, 0) / sum(zone_counts[zid].values())
        for zid in zone_ids
    ])
    nz = len(majority_zone_props)
    if nz > 1:
        arr = np.array(majority_zone_props)
        cumulative = np.cumsum(arr) / (arr.sum() + 1e-15)
        gini = float(1.0 - 2.0 * np.trapezoid(cumulative, np.linspace(0.0, 1.0, nz)))
        gini = max(0.0, gini)
    else:
        gini = 0.0

    # ── Zone detail for map ──────────────────────────────────────────────────
    zone_details = []
    for zid in zone_ids:
        coords = zone_coords[zid]
        lat_c = float(np.mean([c[0] for c in coords]))
        lon_c = float(np.mean([c[1] for c in coords]))
        ti = sum(zone_counts[zid].values())
        composition = {g: zone_counts[zid].get(g, 0) for g in all_groups}
        zone_majority_pct = composition.get(majority_group, 0) / ti
        zone_entropy = _entropy_bits([composition.get(g, 0) / ti for g in all_groups])
        zone_details.append({
            "zone_id": f"{zid[0]}_{zid[1]}",
            "lat": lat_c,
            "lon": lon_c,
            "n": ti,
            "composition": composition,
            "majority_pct": round(float(zone_majority_pct), 4),
            "entropy": round(float(zone_entropy), 4),
        })
    zone_details.sort(key=lambda z: -z["n"])

    # ── Interpretation strings ───────────────────────────────────────────────
    def _d_level(d: float) -> str:
        if d < 0.3:
            return "low (D < 0.30 — zones are well-integrated)"
        if d < 0.6:
            return "moderate (0.30 ≤ D < 0.60 — partial clustering)"
        return "high (D ≥ 0.60 — strong spatial segregation)"

    ratio_isolation = P_isolation / (group_props[majority_group] + 1e-12)

    def _iso_level(r: float) -> str:
        if r > 1.5:
            return "high (group strongly co-located)"
        if r > 1.1:
            return "moderate"
        return "low (near random mixing)"

    return {
        # Five indices
        "dissimilarity_D": round(float(D), 4),
        "isolation_xPx": round(float(P_isolation), 4),
        "interaction_xPy": round(float(P_interaction), 4),
        "entropy_H": round(float(H_entropy), 4),
        "gini": round(float(gini), 4),
        # Context
        "n_zones": n_zones,
        "n_groups": len(all_groups),
        "group_labels": all_groups,
        "majority_group": majority_group,
        "minority_group": minority_group,
        "group_totals": group_totals,
        "group_props": {g: round(float(v), 4) for g, v in group_props.items()},
        "overall_entropy": round(float(E_overall), 4),
        # Per-zone detail (capped for payload)
        "zone_details": zone_details[:200],
        # Interpretation
        "interpretation": {
            "D": _d_level(D),
            "isolation": _iso_level(ratio_isolation),
            "entropy_normalised": round(float(H_entropy), 4),
            "summary": (
                f"Dissimilarity D = {D:.2f} ({_d_level(D).split('(')[0].strip()}). "
                f"Isolation P*aa = {P_isolation:.2f} vs. expected {group_props[majority_group]:.2f}. "
                f"Entropy H = {H_entropy:.2f} (0=perfectly clustered, 1=uniform)."
            ),
        },
        "n": n,
    }


class GroupRow(BaseModel):
    id: str
    lat: float
    lon: float
    group_value: Optional[str]


class Req(BaseModel):
    project_id: str
    rows: list[GroupRow]
    zone_size_deg: float = 0.1


@router.post("")
def post(req: Req):
    rows_d = [r.model_dump() for r in req.rows]
    out = compute(rows_d, zone_size_deg=req.zone_size_deg)
    write_cache(req.project_id, "V2_segregation", out)
    return out
