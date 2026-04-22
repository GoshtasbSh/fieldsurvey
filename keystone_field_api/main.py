"""KeyStone Field API — Admin upload backend.

Handles XLSX/CSV uploads, geocoding, and Supabase inserts.
Separate service from the existing app.py dashboard.

Deploy to Render.com with:
  SUPABASE_URL=...
  SUPABASE_SERVICE_ROLE_KEY=...
  PORT=8051
"""

import asyncio
import io
import logging
import os
import re
import time
from pathlib import Path

import httpx
import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from supabase import create_client

log = logging.getLogger("ks-api")
logging.basicConfig(level=logging.INFO)

# ── Supabase (service role — bypasses RLS for admin inserts) ──────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
sb = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None

app = FastAPI(title="KeyStone Field API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Geocoding (US Census, same logic as main dashboard) ───────────────────────
def geocode(addr: str):
    """Return (lon, lat, matched_address) or (None, None, None)."""
    full = re.sub(r"\s+", " ", addr.strip()) + ", Keystone Heights, FL"
    try:
        r = httpx.get(
            "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
            params={"address": full, "benchmark": "Public_AR_Current", "format": "json"},
            timeout=15,
        )
        matches = r.json().get("result", {}).get("addressMatches", [])
        if matches:
            c = matches[0]["coordinates"]
            return c["x"], c["y"], matches[0]["matchedAddress"]
    except Exception as e:
        log.warning("Geocode fail: %s", e)
    return None, None, None


def extract_street(addr: str) -> str:
    """Pull just the street name from a full address string."""
    parts = re.split(r",|\s+FL\b|\s+\d{5}", addr)
    street = parts[0].strip() if parts else addr
    street = re.sub(r"^\d+\s+", "", street).strip()
    return street or addr


# ── Status mapping (mirrors existing dashboard) ────────────────────────────────
STATUS_MAP = {
    "completed":     "Completed",
    "no answer":     "No Answer",
    "no ans":        "No Answer",
    "inaccessible":  "Inaccessible",
    "not interested":"Not Interested",
    "left info":     "Left Info",
    "left flyer":    "Left Info",
    "vacant":        "Vacant",
    "follow up":     "Follow Up",
    "other":         "Other",
}

STATUS_COLORS = {
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


def categorize(detail: str) -> str:
    d = str(detail).lower().strip()
    for key, val in STATUS_MAP.items():
        if key in d:
            return val
    return "Unknown"


# ═════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/")
def health():
    return {"status": "ok", "service": "KeyStone Field API"}


# ── Community contacts upload ─────────────────────────────────────────────────
@app.post("/api/upload/community")
async def upload_community(file: UploadFile = File(...)):
    """
    Accept an XLSX file, geocode addresses, insert into community_contacts.
    Clears existing data before inserting.
    """
    if not sb:
        raise HTTPException(503, "Supabase not configured on this server")

    suf = Path(file.filename).suffix.lower()
    if suf not in (".xlsx", ".xls"):
        raise HTTPException(400, "Upload an Excel file (.xlsx or .xls)")

    raw = await file.read()
    df = pd.read_excel(io.BytesIO(raw))
    df.columns = [str(c).strip() for c in df.columns]

    # Detect address column
    addr_col = next((c for c in df.columns if "address" in c.lower()), None)
    if not addr_col:
        raise HTTPException(400, "No 'Address' column found in file")

    attempt_col  = next((c for c in df.columns if "first" in c.lower() and "attempt" in c.lower()), None)
    second_col   = next((c for c in df.columns if "second" in c.lower() and "attempt" in c.lower()), None)
    notes_col    = next((c for c in df.columns if "notes" in c.lower()), None)
    date_col     = next((c for c in df.columns if "date" in c.lower()), None)

    log.info("Community upload: %d rows, geocoding…", len(df))

    rows = []
    loop = asyncio.get_event_loop()

    for _, row in df.iterrows():
        addr = str(row.get(addr_col, "")).strip()
        if not addr or addr == "nan":
            continue
        detail = str(row.get(attempt_col, "")) if attempt_col else ""
        status = categorize(detail)
        street = extract_street(addr)

        lon, lat, matched = await loop.run_in_executor(None, geocode, addr)
        time.sleep(0.2)

        rows.append({
            "address":        addr,
            "status":         status,
            "status_detail":  detail,
            "second_attempt": str(row.get(second_col, "")) if second_col else None,
            "notes":          str(row.get(notes_col, "")) if notes_col else None,
            "survey_date":    str(row.get(date_col, "")) if date_col else None,
            "street_name":    street,
            "matched_address": matched or None,
            "lat":            lat,
            "lon":            lon,
            "color":          STATUS_COLORS.get(status, "#9ca3af"),
        })

    if not rows:
        raise HTTPException(400, "No geocodable addresses found")

    # Clear existing and insert fresh
    sb.table("community_contacts").delete().neq("id", -1).execute()
    # Batch insert in chunks of 100
    for i in range(0, len(rows), 100):
        sb.table("community_contacts").insert(rows[i:i+100]).execute()

    geocoded = sum(1 for r in rows if r["lat"])
    log.info("Inserted %d community contacts (%d geocoded)", len(rows), geocoded)
    return {"status": "ok", "points": len(rows), "geocoded": geocoded}


# ── IAQ upload ────────────────────────────────────────────────────────────────
@app.post("/api/upload/iaq")
async def upload_iaq(file: UploadFile = File(...)):
    """
    Accept a Qualtrics CSV, compute risk scores, geocode, insert into iaq_surveys.
    """
    if not sb:
        raise HTTPException(503, "Supabase not configured on this server")

    suf = Path(file.filename).suffix.lower()
    if suf != ".csv":
        raise HTTPException(400, "Upload a CSV file exported from Qualtrics")

    raw = await file.read()
    df = pd.read_csv(io.BytesIO(raw))
    df.columns = [str(c).strip() for c in df.columns]

    # Skip Qualtrics header rows (rows 0 and 1 are metadata)
    if len(df) > 2:
        df = df.iloc[2:].reset_index(drop=True)

    addr_col = next((c for c in df.columns if "address" in c.lower()), None)
    street_col = next((c for c in df.columns if "street" in c.lower()), None)
    col_for_addr = addr_col or street_col

    log.info("IAQ upload: %d rows", len(df))

    def freq_score(val):
        v = str(val).lower() if val and not pd.isna(val) else ""
        if "weekly" in v: return 4
        if "month" in v:  return 3
        if "season" in v: return 2
        if "year" in v:   return 1
        return 0

    def health_score(row):
        raw = (
            freq_score(row.get("Headache")) * 0.5 +
            freq_score(row.get("RespIll"))  * 1.0 +
            freq_score(row.get("asthma"))   * 1.0 +
            freq_score(row.get("wheeze"))   * 0.8 +
            freq_score(row.get("Tired"))    * 0.3
        )
        s = min(raw / 14.4 * 80, 80)
        if "yes" in str(row.get("Hospital Respiratory","")).lower(): s = min(s+20,100)
        return round(s)

    def iaq_score(row):
        s = 0.0
        mold = row.get("Mold")
        if mold and not pd.isna(mold) and str(mold).strip() not in ("","nan"): s += 30
        for col in ["Leakage 2_1","Leakage 2_2","Leakage 2_3","Leakage 2_4"]:
            if str(row.get(col,"")).lower().strip() not in ("","none","nan"): s += 7.5
        if any(kw in str(row.get("Cooking ","")).lower() for kw in ("gas","propane")): s += 10
        return round(min(s, 100))

    def struct_score(row):
        s = 0.0
        cond = str(row.get("Condition","")).lower()
        if "poor" in cond or "very bad" in cond: s = 70
        elif "fair" in cond: s = 40
        elif "good" in cond or "excellent" in cond: s = 10
        return round(s)

    def risk_tier(overall):
        if overall >= 60: return "High"
        if overall >= 30: return "Medium"
        return "Low"

    rows = []
    loop = asyncio.get_event_loop()

    for _, row in df.iterrows():
        addr = str(row.get(col_for_addr, "")).strip() if col_for_addr else ""
        if not addr or addr == "nan":
            continue
        hs = health_score(row)
        iq = iaq_score(row)
        ss = struct_score(row)
        overall = round((hs * 0.4 + iq * 0.4 + ss * 0.2))
        tier = risk_tier(overall)

        lon, lat, _ = await loop.run_in_executor(None, geocode, addr) if addr else (None, None, None)
        time.sleep(0.2)

        rows.append({
            "street_name":  extract_street(addr),
            "health_score": hs,
            "iaq_score":    iq,
            "struct_score": ss,
            "overall_risk": overall,
            "risk_tier":    tier,
            "ownership":    str(row.get("Ownership","")) or None,
            "housing_type": str(row.get("Housing_type","")) or None,
            "year_built":   str(row.get("Year_Built","")) or None,
            "condition":    str(row.get("Condition","")) or None,
            "has_mold":     bool(row.get("Mold") and not pd.isna(row.get("Mold"))),
            "lat":          lat,
            "lon":          lon,
            "color":        "#ef4444" if tier=="High" else ("#f97316" if tier=="Medium" else "#10b981"),
        })

    if not rows:
        raise HTTPException(400, "No processable rows found")

    sb.table("iaq_surveys").delete().neq("id", -1).execute()
    for i in range(0, len(rows), 100):
        sb.table("iaq_surveys").insert(rows[i:i+100]).execute()

    log.info("Inserted %d IAQ surveys", len(rows))
    return {"status": "ok", "points": len(rows)}


# ── Analysis stats ────────────────────────────────────────────────────────────
@app.get("/api/analysis")
def analysis():
    if not sb:
        raise HTTPException(503, "Supabase not configured")
    res = sb.table("field_survey_points").select("status,collected_at").execute()
    pts = res.data or []
    counts = {}
    for p in pts:
        counts[p["status"]] = counts.get(p["status"], 0) + 1
    return {
        "total": len(pts),
        "by_status": counts,
        "community_count": (sb.table("community_contacts").select("id", count="exact").execute().count or 0),
        "iaq_count":       (sb.table("iaq_surveys").select("id", count="exact").execute().count or 0),
    }


# ── Report config ─────────────────────────────────────────────────────────────
@app.get("/api/config")
def get_config():
    if not sb: raise HTTPException(503, "Supabase not configured")
    res = sb.table("report_config").select("*").eq("active", True).limit(1).execute()
    return res.data[0] if res.data else {}


@app.put("/api/config")
async def put_config(body: dict):
    if not sb: raise HTTPException(503, "Supabase not configured")
    email = body.get("email", "")
    if not email: raise HTTPException(400, "email required")
    sb.table("report_config").upsert({"email": email, "active": True}).execute()
    return {"status": "ok"}


# ── CSV export ────────────────────────────────────────────────────────────────
@app.get("/api/export/csv")
def export_csv():
    if not sb: raise HTTPException(503, "Supabase not configured")
    res = sb.table("field_survey_points")\
        .select("id,collected_at,status,notes,collector_name,lat,lon")\
        .order("collected_at", desc=True).execute()
    pts = res.data or []

    def generate():
        yield "ID,Date,Time,Status,Collector,Lat,Lon,Notes\n"
        for p in pts:
            d = p.get("collected_at", "")[:10]
            t = p.get("collected_at", "")[11:16]
            yield ",".join([
                str(p.get("id","")),
                d, t,
                p.get("status",""),
                (p.get("collector_name","") or "").replace(",",";"),
                str(p.get("lat","")),
                str(p.get("lon","")),
                (p.get("notes","") or "").replace(",",";").replace("\n"," "),
            ]) + "\n"

    fname = f"keystone_survey.csv"
    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── Run ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8051))
    uvicorn.run(app, host="0.0.0.0", port=port)
