"""GET or POST /api/daily-refresh — scheduled merge of field_survey_points into
the cached community-contact GeoJSON blob.

Invoked by Vercel Cron (see vercel.json). Lightweight — no geopandas/fiona.
Heavy spatial analysis (parcel matching, STRtree) is performed once by the
local admin via scripts/ingest.py when new parcel or contact data arrives.

Protected by CRON_SECRET header when called from Vercel's scheduler.
"""
from http.server import BaseHTTPRequestHandler
from datetime import date, datetime
import os

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import supabase_admin, load_cached, json_response, empty_geojson


def _field_row_to_feature(row: dict) -> dict:
    lon = row.get("lon"); lat = row.get("lat")
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "source": "field",
            "field_point_id": row.get("id"),
            "status": row.get("status") or "Unknown",
            "notes": row.get("notes") or "",
            "collector": row.get("collector_name"),
            "collector_id": row.get("collector_id"),
            "collected_at": row.get("collected_at"),
            "address": row.get("address") or "",
        },
    }


def _run_refresh() -> dict:
    sb = supabase_admin()
    if not sb:
        return {"refreshed": False, "reason": "Supabase service role key not configured"}

    # Last snapshot timestamp
    try:
        versions = (
            sb.table("keystone_analysis_versions")
            .select("created_at")
            .eq("data_type", "community_contact")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        last_at = versions.data[0]["created_at"] if versions.data else "2000-01-01T00:00:00Z"
    except Exception as e:
        return {"refreshed": False, "reason": f"Could not read versions: {e}"}

    # New field points since then
    try:
        res = (
            sb.table("field_survey_points")
            .select("id, lat, lon, status, notes, collector_id, collector_name, collected_at")
            .gt("collected_at", last_at)
            .execute()
        )
        new_rows = res.data or []
    except Exception as e:
        return {"refreshed": False, "reason": f"Could not read field points: {e}"}

    if not new_rows:
        return {"refreshed": False, "reason": "No new field data since last snapshot",
                "last_analysis": last_at}

    # Load existing cached survey-points blob and append
    existing = load_cached("survey_points") or empty_geojson()
    features = list(existing.get("features") or [])
    features.extend(_field_row_to_feature(r) for r in new_rows)
    merged = {"type": "FeatureCollection", "features": features}

    label = f"Daily Update {date.today().isoformat()} — {len(new_rows)} new field visits ({len(features)} total)"

    # Persist merged blob + version snapshot
    try:
        sb.table("keystone_dashboard_data").upsert({
            "data_type": "survey_points",
            "payload": merged,
            "updated_at": datetime.utcnow().isoformat(),
        }, on_conflict="data_type").execute()
        sb.table("keystone_analysis_versions").insert({
            "data_type": "community_contact",
            "payload": merged,
            "label": label,
            "n_points": len(features),
        }).execute()
    except Exception as e:
        return {"refreshed": False, "reason": f"Write failed: {e}"}

    return {"refreshed": True, "new_field_points": len(new_rows),
            "total_points": len(features), "label": label}


def _authorized(headers) -> bool:
    """Allow when CRON_SECRET is unset (local dev) or the caller matches."""
    secret = os.environ.get("CRON_SECRET", "")
    if not secret:
        return True
    got = headers.get("authorization", "")
    return got == f"Bearer {secret}"


class handler(BaseHTTPRequestHandler):
    def _handle(self):
        if not _authorized(self.headers):
            json_response(self, 401, {"error": "unauthorized"})
            return
        try:
            result = _run_refresh()
            json_response(self, 200, result)
        except Exception as e:
            json_response(self, 500, {"error": str(e)})

    def do_GET(self):  # Vercel Cron issues GET
        self._handle()

    def do_POST(self):  # Manual trigger during testing
        self._handle()
