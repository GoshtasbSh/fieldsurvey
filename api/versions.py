"""GET /api/versions — list historical analysis snapshots."""
from http.server import BaseHTTPRequestHandler

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent))
from _lib import supabase_admin, supabase_anon, json_response


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        sb = supabase_admin() or supabase_anon()
        if not sb:
            json_response(self, 200, [])
            return
        try:
            r = (
                sb.table("keystone_analysis_versions")
                .select("id, data_type, label, n_points, created_at")
                .order("created_at", desc=True)
                .limit(100)
                .execute()
            )
            rows = r.data or []
            # Dashboard expects {community_contact: [...], iaq_survey: [...]}
            grouped = {
                "community_contact": [x for x in rows if x["data_type"] == "community_contact"],
                "iaq_survey":        [x for x in rows if x["data_type"] == "iaq_survey"],
            }
            json_response(self, 200, grouped)
        except Exception as e:
            json_response(self, 500, {"error": str(e)})
