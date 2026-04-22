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
            json_response(self, 200, r.data or [])
        except Exception as e:
            json_response(self, 500, {"error": str(e)})
