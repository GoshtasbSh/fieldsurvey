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
import json
import time
import shutil
import logging
from pathlib import Path

import pandas as pd
import geopandas as gpd
import shapely
import requests
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# ── Paths ────────────────────────────────────────────────────────────────────
BASE = Path(__file__).parent
DATA = BASE / "data"
OUT = BASE / "output"
STATIC = BASE / "static"
SURVEY_FILE = DATA / "Community Survey Contact Data .xlsx"
GDB_FILE = DATA / "Parcels.gdb"
CACHE_PTS = OUT / "survey_geocoded.geojson"
CACHE_PAR = OUT / "parcels_keystone.geojson"
CACHE_RES = OUT / "survey_results.json"

OUT.mkdir(exist_ok=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("keystone")

# ── Status config ────────────────────────────────────────────────────────────
STATUS = {
    "Completed":     "#10b981",
    "No Answer":     "#f97316",
    "Inaccessible":  "#ef4444",
    "Not Interested": "#8b5cf6",
    "Left Info":     "#3b82f6",
    "Vacant":        "#6b7280",
    "Follow Up":     "#06b6d4",
    "Other":         "#ec4899",
    "Unknown":       "#9ca3af",
}


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


# ── Geocoding ────────────────────────────────────────────────────────────────
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


# ── Data processing ──────────────────────────────────────────────────────────
def process_survey():
    if CACHE_PTS.exists():
        log.info("Survey points: loaded from cache")
        return json.loads(CACHE_PTS.read_text())

    log.info("Geocoding survey addresses (first run, ~2 min)...")
    df = pd.read_excel(SURVEY_FILE)
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

        street = re.sub(r"^\d+\s+", "", addr).strip()
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
    CACHE_PTS.write_text(json.dumps(gj))
    log.info(f"Geocoded {len(features)}/{len(df)} ({len(fails)} failed)")
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

        # Value histogram bins
        val_bins = []
        if vals:
            import numpy as np
            edges = [0, 25000, 50000, 75000, 100000, 150000, 200000, 300000, 500000, float("inf")]
            labels = ["<25k", "25-50k", "50-75k", "75-100k", "100-150k", "150-200k", "200-300k", "300-500k", "500k+"]
            for j in range(len(edges) - 1):
                cnt = sum(1 for v in vals if edges[j] <= v < edges[j + 1])
                val_bins.append({"label": labels[j], "count": cnt})

        # Year histogram
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
        "streets": [{"name": n, "count": c, "statuses": st_status.get(n, {})} for n, c in streets],
        "parcel_stats": ps,
    }


# ── FastAPI ──────────────────────────────────────────────────────────────────
survey_data: dict = {}
parcels_data: dict = {}
analysis: dict = {}
survey_results: dict = {}


@asynccontextmanager
async def lifespan(application):
    global survey_data, parcels_data, analysis
    log.info("=" * 50)
    log.info("  KeyStone Field Survey Dashboard")
    log.info("=" * 50)
    survey_data = process_survey()
    parcels_data = process_parcels()
    analysis = compute_analysis(survey_data, parcels_data)
    log.info("-" * 50)
    log.info("  Ready! Open http://localhost:8050")
    log.info("-" * 50)
    yield


app = FastAPI(title="KeyStone Survey Dashboard", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/")
async def root():
    return FileResponse(STATIC / "index.html")


@app.get("/api/survey-points")
async def api_pts():
    return JSONResponse(survey_data)


@app.get("/api/parcels")
async def api_par():
    return JSONResponse(parcels_data)


@app.get("/api/analysis")
async def api_analysis():
    return JSONResponse(analysis)


@app.get("/api/survey-results")
async def api_results():
    if not survey_results:
        return JSONResponse({"loaded": False})
    return JSONResponse({"loaded": True, "data": survey_results})


@app.post("/api/upload/survey")
async def upload_survey(file: UploadFile = File(...)):
    global survey_data, analysis
    suf = Path(file.filename).suffix
    if suf not in (".xlsx", ".xls", ".csv"):
        raise HTTPException(400, "Upload Excel or CSV")
    tmp = OUT / f"uploaded_survey{suf}"
    with open(tmp, "wb") as f:
        f.write(await file.read())
    shutil.copy2(tmp, DATA / file.filename)
    if CACHE_PTS.exists():
        CACHE_PTS.unlink()
    survey_data = process_survey()
    analysis = compute_analysis(survey_data, parcels_data)
    return {"status": "ok", "points": len(survey_data.get("features", []))}


@app.post("/api/upload/results")
async def upload_results(file: UploadFile = File(...)):
    global survey_results
    suf = Path(file.filename).suffix
    tmp = OUT / f"survey_results{suf}"
    with open(tmp, "wb") as f:
        f.write(await file.read())
    df = pd.read_csv(tmp) if suf == ".csv" else pd.read_excel(tmp)
    survey_results = {"columns": list(df.columns), "rows": df.fillna("").to_dict("records"), "count": len(df)}
    CACHE_RES.write_text(json.dumps(survey_results))
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
