"""
One-shot: rebuild parcel_stats inside keystone_dashboard_data['analysis'].

Run when the Parcels tab in the dashboard shows 0 / empty (e.g. after a
survey or IAQ upload that pre-dated the merge_preserve_analysis fix
silently wiped it).

It reads parcels from the Supabase `parcels` table (already populated
by scripts/export_parcels_to_supabase.py), computes the same stats
shape app.py:compute_contact_analysis() builds (total / land_use /
values / areas / years + value+year histograms), and merges that into
the cached analysis blob without touching streets / status_counts /
total_points.

Usage:
  python scripts/refresh_parcel_stats.py

Environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # .env loading is optional; env may already be set

try:
    from supabase import create_client
except ImportError:
    sys.exit("ERROR: pip install supabase python-dotenv")

URL = os.environ.get("SUPABASE_URL", "")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not URL or not KEY:
    sys.exit("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env or env.")

sb = create_client(URL, KEY)


def _stats(arr):
    if not arr:
        return {"mean": 0, "median": 0, "min": 0, "max": 0}
    s = sorted(arr)
    return {
        "mean":   round(sum(s) / len(s)),
        "median": round(s[len(s) // 2]),
        "min":    round(min(s)),
        "max":    round(max(s)),
    }


def _load_parcels():
    """Two sources, in order of preference:

      1. The cached parcels GeoJSON in `keystone_dashboard_data['parcels']`
         — this is what the live dashboard reads via /api/parcels, so
         using it guarantees the parcel_stats we compute match what
         the user actually sees on the map.
      2. The denormalised `parcels` table populated by
         scripts/export_parcels_to_supabase.py, used as fallback.

    Each source returns a uniform list of dicts with the keys
    parcel_id / address / land_use / just_value / living_area /
    year_built so the stats builder doesn't care which one was used.
    """
    # 1. Cached blob (this is the dashboard's actual source today).
    try:
        r = sb.table("keystone_dashboard_data").select("payload").eq("data_type", "parcels").execute()
        payload = r.data[0]["payload"] if r.data else None
        if payload and isinstance(payload, dict):
            feats = payload.get("features") or []
            if feats:
                rows = []
                for f in feats:
                    p = (f.get("properties") or {}) if isinstance(f, dict) else {}
                    rows.append({
                        "parcel_id":   p.get("parcel_id"),
                        "address":     p.get("address"),
                        "land_use":    p.get("land_use"),
                        "just_value":  p.get("just_value"),
                        "living_area": p.get("living_area"),
                        "year_built":  p.get("year_built"),
                    })
                print(f"  source: keystone_dashboard_data['parcels'] cached blob")
                return rows
    except Exception as e:
        print(f"  cached blob read failed: {e}")

    # 2. Fallback: the `parcels` table (export_parcels_to_supabase.py).
    rows, offset, page = [], 0, 1000
    while True:
        try:
            r = (sb.table("parcels")
                  .select("parcel_id,address,land_use,just_value,living_area,year_built")
                  .range(offset, offset + page - 1)
                  .execute())
        except Exception:
            break
        batch = r.data or []
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    if rows:
        print(f"  source: `parcels` table")
    return rows


def _build_parcel_stats(parcels):
    if not parcels:
        return {}
    vals  = [p["just_value"]   for p in parcels if p.get("just_value")   and p["just_value"]   > 0]
    areas = [p["living_area"]  for p in parcels if p.get("living_area")  and p["living_area"]  > 0]
    yrs   = [p["year_built"]   for p in parcels if p.get("year_built")   and p["year_built"]   > 1800]

    lu = {}
    for p in parcels:
        g = p.get("land_use") or "Other"
        lu[g] = lu.get(g, 0) + 1

    val_bins = []
    if vals:
        edges  = [0, 25_000, 50_000, 75_000, 100_000, 150_000, 200_000, 300_000, 500_000, float("inf")]
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

    return {
        "total":           len(parcels),
        "land_use":        lu,
        "values":          _stats(vals),
        "areas":           _stats(areas),
        "years": {
            "mean":   round(sum(yrs) / len(yrs)) if yrs else 0,
            "oldest": min(yrs) if yrs else 0,
            "newest": max(yrs) if yrs else 0,
        },
        "value_histogram": val_bins,
        "year_histogram":  yr_bins,
    }


def main():
    print("Loading parcels from Supabase…")
    parcels = _load_parcels()
    print(f"Loaded {len(parcels)} parcels.")

    if not parcels:
        sys.exit(
            "ERROR: no parcels found in keystone_dashboard_data['parcels'] "
            "or the `parcels` table. Either run app.py locally to ingest the "
            ".gdb (it auto-saves to keystone_dashboard_data on first load), "
            "or run scripts/export_parcels_to_supabase.py to populate the table."
        )

    print("Building parcel_stats…")
    ps = _build_parcel_stats(parcels)
    print(f"  total: {ps['total']}")
    print(f"  values mean={ps['values']['mean']:,} median={ps['values']['median']:,}")
    print(f"  areas  mean={ps['areas']['mean']:,} median={ps['areas']['median']:,}")
    print(f"  years  oldest={ps['years']['oldest']} newest={ps['years']['newest']} mean={ps['years']['mean']}")
    print(f"  land_use buckets: {len(ps['land_use'])}")

    # Read existing analysis blob, splice parcel_stats in, write back.
    print("Loading existing analysis blob…")
    r = sb.table("keystone_dashboard_data").select("payload").eq("data_type", "analysis").execute()
    existing = (r.data[0]["payload"] if r.data else None) or {}
    if not isinstance(existing, dict):
        existing = {}

    existing["parcel_stats"] = ps

    print("Writing merged analysis back to Supabase…")
    sb.table("keystone_dashboard_data").upsert(
        {"data_type": "analysis", "payload": existing},
        on_conflict="data_type",
    ).execute()
    print("✓ Done. Reload the dashboard — Parcels tab will be populated.")


if __name__ == "__main__":
    main()
