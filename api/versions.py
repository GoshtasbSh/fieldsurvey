"""GET  /api/versions                — list historical analysis snapshots.
POST /api/versions?id=<version_id> — restore a snapshot (admin-only).

Consolidated from the previous api/versions.py (GET) + api/versions/restore.py (POST)
to fit the Hobby plan's 12-function ceiling.
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import supabase_admin, supabase_anon, json_response, require_admin
from _processing import compute_contact_analysis


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        sb = supabase_admin() or supabase_anon()
        if not sb:
            json_response(self, 200, [])
            return
        try:
            r = (sb.table("keystone_analysis_versions")
                   .select("id, data_type, label, n_points, created_at")
                   .order("created_at", desc=True)
                   .limit(100)
                   .execute())
            rows = r.data or []
            grouped = {
                "community_contact": [x for x in rows if x["data_type"] == "community_contact"],
                "iaq_survey":        [x for x in rows if x["data_type"] == "iaq_survey"],
            }
            json_response(self, 200, grouped)
        except Exception as e:
            json_response(self, 500, {"error": str(e)})

    def do_POST(self):
        # POST = restore a version. Admin only.
        if require_admin(self) is None:
            return
        qs  = parse_qs(urlparse(self.path).query)
        raw = qs.get("id", [""])[0]
        if not raw or not raw.isdigit():
            json_response(self, 400, {"error": "Missing or invalid ?id= parameter."})
            return
        version_id = int(raw)

        sb = supabase_admin()
        if not sb:
            json_response(self, 500, {"error": "Supabase service key not configured."})
            return

        r = (sb.table("keystone_analysis_versions")
               .select("id, label, data_type, payload, created_at")
               .eq("id", version_id)
               .execute())
        if not r.data:
            json_response(self, 404, {"error": "Version not found."})
            return

        v       = r.data[0]
        payload = v["payload"]

        if "features" in payload:          # community_contact blob
            sb.table("keystone_dashboard_data").upsert(
                {"data_type": "community_contact", "payload": payload},
                on_conflict="data_type",
            ).execute()
            try:
                contact_analysis = compute_contact_analysis(payload.get("features", []))
                sb.table("keystone_dashboard_data").upsert(
                    {"data_type": "analysis", "payload": contact_analysis},
                    on_conflict="data_type",
                ).execute()
            except Exception:
                pass
            json_response(self, 200, {
                "restored": True,
                "type":     "community_contact",
                "label":    v["label"],
                "points":   len(payload.get("features", [])),
            })
            return

        if "geojson" in payload:           # iaq_survey blob
            sb.table("keystone_dashboard_data").upsert(
                {"data_type": "iaq_survey", "payload": payload},
                on_conflict="data_type",
            ).execute()
            json_response(self, 200, {
                "restored": True,
                "type":     "iaq_survey",
                "label":    v["label"],
                "points":   len(payload.get("geojson", {}).get("features", [])),
            })
            return

        json_response(self, 400, {"error": "Unknown payload format."})
