"""
verify_iaq_matches.py — spot-check the v3 IAQ↔contact matcher.

Pulls the cached community_contact + iaq_survey blobs from Supabase,
walks every contact that has has_iaq_survey=True, and for each match
prints:

  - the contact's address
  - the matched IAQ's raw_address (typed by respondent)
  - distance between the contact and IAQ rep-points (should be ≤1 m
    under v3 parcel-rep-point equality)
  - a fuzzy-match score between the two addresses
  - the IAQ overall_risk score

At the end:

  - prints any matches where the address fuzzy-match is below 0.50
    (likely wrong household — investigate)
  - prints unmatched IAQ responses (parcel has no community contact)
  - dumps a CSV at /tmp/iaq_matches.csv for offline review

Run with the same env as refresh_parcel_stats.py:

  python scripts/verify_iaq_matches.py
"""
from __future__ import annotations

import csv
import difflib
import os
import sys
from math import asin, cos, radians, sin, sqrt

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    from supabase import create_client
except ImportError:
    sys.exit("ERROR: pip install supabase python-dotenv")

URL = os.environ.get("SUPABASE_URL", "")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not URL or not KEY:
    sys.exit("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env or env.")

sb = create_client(URL, KEY)


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6_371_000
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * R * asin(sqrt(a))


def addr_norm(s: str) -> str:
    """Cheap normaliser for the fuzzy-match score."""
    if not s:
        return ""
    s = s.upper()
    for x in (",", ".", "  "):
        s = s.replace(x, " ")
    return " ".join(s.split())


def main():
    print("Loading community_contact blob…")
    r = sb.table("keystone_dashboard_data").select("payload").eq("data_type", "community_contact").execute()
    if not r.data:
        sys.exit("ERROR: no community_contact blob in keystone_dashboard_data.")
    contacts_payload = r.data[0]["payload"] or {}
    contacts = contacts_payload.get("features") or []
    print(f"  {len(contacts)} community contact features.")

    print("Loading iaq_survey blob…")
    r = sb.table("keystone_dashboard_data").select("payload").eq("data_type", "iaq_survey").execute()
    if not r.data:
        sys.exit("ERROR: no iaq_survey blob in keystone_dashboard_data.")
    iaq_payload = r.data[0]["payload"] or {}
    iaq_features = (iaq_payload.get("geojson") or {}).get("features") or []
    print(f"  {len(iaq_features)} IAQ features.")

    # Index IAQ by rep-point coord (rounded to 6 decimals — same as v3).
    iaq_by_coord = {}
    for f in iaq_features:
        c = f.get("geometry", {}).get("coordinates") or [None, None]
        key = (round(float(c[0]), 6), round(float(c[1]), 6))
        iaq_by_coord.setdefault(key, []).append(f)

    matched_rows = []
    suspicious = []
    print("\nWalking matched contacts…")
    for cf in contacts:
        cp = cf.get("properties") or {}
        if not cp.get("has_iaq_survey"):
            continue
        c_addr = cp.get("address") or ""
        c_coords = cf.get("geometry", {}).get("coordinates") or [None, None]
        m_lon = cp.get("iaq_match_lon")
        m_lat = cp.get("iaq_match_lat")

        # Find the IAQ feature at the stored match coord.
        iaq_f = None
        if m_lon is not None and m_lat is not None:
            key = (round(float(m_lon), 6), round(float(m_lat), 6))
            iaq_f = (iaq_by_coord.get(key) or [None])[0]

        # Fallback: search by contact coord ≤1 m (legacy contacts pre-v3).
        if iaq_f is None and c_coords[0] is not None:
            for cand in iaq_features:
                ic = cand.get("geometry", {}).get("coordinates") or [0, 0]
                d = haversine_m(c_coords[1], c_coords[0], ic[1], ic[0])
                if d <= 1.0:
                    iaq_f = cand
                    break

        if iaq_f is None:
            suspicious.append({
                "issue": "matched contact has no resolvable IAQ feature",
                "contact_address": c_addr,
                "iaq_match_lon": m_lon,
                "iaq_match_lat": m_lat,
            })
            continue

        ip = iaq_f.get("properties") or {}
        ig = iaq_f.get("geometry", {}).get("coordinates") or [None, None]
        # Note: raw_address is stripped from public IAQ features; keys
        # below are best-effort. If raw_address isn't preserved, we
        # fall back to street_name for the cross-check.
        i_addr = (ip.get("raw_address") or ip.get("street_name") or "").strip()
        d_m = (haversine_m(c_coords[1], c_coords[0], ig[1], ig[0])
               if c_coords[0] is not None and ig[0] is not None else None)
        score = difflib.SequenceMatcher(None, addr_norm(c_addr), addr_norm(i_addr)).ratio() if (c_addr and i_addr) else 0.0

        row = {
            "contact_address":  c_addr,
            "iaq_text":         i_addr,
            "fuzzy_score":      round(score, 3),
            "distance_m":       round(d_m, 2) if d_m is not None else "",
            "iaq_overall_risk": ip.get("overall_risk", ""),
            "iaq_risk_tier":    ip.get("risk_tier", ""),
        }
        matched_rows.append(row)
        if score < 0.50:
            suspicious.append({
                "issue": f"low fuzzy score ({score:.2f}) — addresses disagree",
                **row,
            })

    # IAQ that didn't match any contact (flyer respondents).
    matched_iaq_keys = {(round(float(cp.get('iaq_match_lon') or 0), 6),
                        round(float(cp.get('iaq_match_lat') or 0), 6))
                       for cf in contacts
                       for cp in [cf.get('properties') or {}]
                       if cp.get('has_iaq_survey')}
    flyer_rows = []
    for f in iaq_features:
        c = f.get("geometry", {}).get("coordinates") or [0, 0]
        key = (round(float(c[0]), 6), round(float(c[1]), 6))
        if key not in matched_iaq_keys:
            ip = f.get("properties") or {}
            flyer_rows.append({
                "iaq_text": ip.get("raw_address") or ip.get("street_name") or "(no address)",
                "iaq_lon":  c[0],
                "iaq_lat":  c[1],
                "iaq_overall_risk": ip.get("overall_risk", ""),
                "coord_source": ip.get("coord_source", ""),
            })

    print(f"\n  Matched contacts:        {len(matched_rows)}")
    print(f"  Unmatched IAQ (flyer):    {len(flyer_rows)}")
    print(f"  Suspicious matches:       {len(suspicious)}")

    if suspicious:
        print("\n=== SUSPICIOUS ROWS (review manually) ===")
        for s in suspicious[:30]:
            print(f"  {s}")
        if len(suspicious) > 30:
            print(f"  … and {len(suspicious) - 30} more (see CSV).")

    if flyer_rows:
        print("\n=== UNMATCHED IAQ — flyer / QR / out-of-area respondents ===")
        for s in flyer_rows[:15]:
            print(f"  {s.get('iaq_text', '')[:60]:60s}  risk={s.get('iaq_overall_risk', '')}")
        if len(flyer_rows) > 15:
            print(f"  … and {len(flyer_rows) - 15} more (see CSV).")

    # Dump CSVs for offline review.
    out = "/tmp/iaq_matches.csv"
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=[
            "contact_address", "iaq_text", "fuzzy_score",
            "distance_m", "iaq_overall_risk", "iaq_risk_tier",
        ])
        w.writeheader()
        for row in matched_rows:
            w.writerow(row)

    out_flyer = "/tmp/iaq_flyer.csv"
    with open(out_flyer, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=[
            "iaq_text", "iaq_lon", "iaq_lat", "iaq_overall_risk", "coord_source",
        ])
        w.writeheader()
        for row in flyer_rows:
            w.writerow(row)

    print(f"\n  Matched matches  →  {out}")
    print(f"  Flyer respondents → {out_flyer}")
    print("\n✓ Done. Open the CSVs in Excel / Numbers to review by row.")


if __name__ == "__main__":
    main()
