"""
One-time parcel migration: GDB → Supabase `parcels` table.

Run once locally (not on the server) after setting up Supabase:

  pip install geopandas shapely supabase python-dotenv
  python scripts/export_parcels_to_supabase.py

Environment variables (can be in .env):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  GDB_PATH   (optional override; defaults to data/*.gdb)
"""

import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Find GDB file ─────────────────────────────────────────────────────────────
GDB_PATH = os.environ.get("GDB_PATH", "")
if not GDB_PATH:
    data_dir = Path(__file__).parent.parent / "data"
    gdbs = list(data_dir.glob("*.gdb"))
    if not gdbs:
        sys.exit(f"ERROR: No .gdb file found in {data_dir}. Set GDB_PATH env var.")
    GDB_PATH = str(gdbs[0])

print(f"Reading parcels from: {GDB_PATH}")

try:
    import geopandas as gpd
    import shapely
except ImportError:
    sys.exit("ERROR: pip install geopandas shapely")

# ── Load + filter Keystone Heights parcels ────────────────────────────────────
gdf = gpd.read_file(
    GDB_PATH,
    layer="CADASTRAL_DOR",
    where="PHY_CITY = 'KEYSTONE HEIGHTS'",
)
print(f"Loaded {len(gdf)} parcels from GDB")

gdf = gdf.to_crs(epsg=4326)
gdf.geometry = gdf.geometry.map(shapely.force_2d)
gdf.geometry = gdf.geometry.simplify(0.00005, preserve_topology=True)

KEEP = {
    "PARCEL_ID": "parcel_id",
    "PHY_ADDR1": "address",
    "DOR_UC":    "land_use",
    "JV":        "just_value",
    "AV_SD":     "assessed_value",
    "TOT_LVG_AR":"living_area",
    "EFF_YR_BLT":"year_built",
}
avail = {k: v for k, v in KEEP.items() if k in gdf.columns}
gdf = gdf[list(avail.keys()) + ["geometry"]].rename(columns=avail)

# ── Build insert rows ─────────────────────────────────────────────────────────
rows = []
for _, r in gdf.iterrows():
    try:
        geom = json.loads(r["geometry"].to_json()) if r["geometry"] else None
    except Exception:
        geom = None
    rows.append({
        "parcel_id":     str(r.get("parcel_id", "")) or None,
        "address":       str(r.get("address", "")) or None,
        "land_use":      str(r.get("land_use", "")) or None,
        "just_value":    float(r["just_value"]) if r.get("just_value") else None,
        "assessed_value":float(r["assessed_value"]) if r.get("assessed_value") else None,
        "living_area":   float(r["living_area"]) if r.get("living_area") else None,
        "year_built":    int(r["year_built"]) if r.get("year_built") else None,
        "geometry":      geom,
    })

print(f"Prepared {len(rows)} rows — clearing existing parcels…")
sb.table("parcels").delete().neq("id", -1).execute()

# ── Batch insert ──────────────────────────────────────────────────────────────
BATCH = 200
total = 0
for i in range(0, len(rows), BATCH):
    batch = rows[i:i + BATCH]
    sb.table("parcels").insert(batch).execute()
    total += len(batch)
    print(f"  Inserted {total}/{len(rows)} parcels…")
    time.sleep(0.5)

print(f"Done. {total} parcels written to Supabase.")
