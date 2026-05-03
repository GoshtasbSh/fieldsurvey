"""POST /api/versions/restore?id=<version_id> — Restore a historical snapshot.

Mirrors app.py's POST /api/versions/{id}/restore endpoint.
Dashboard calls this via: fetch('/api/versions/restore?id=123', {method:'POST'})
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).parent.parent))
from _lib import supabase_admin, json_response


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        qs  = parse_qs(urlparse(self.path).query)
        raw = qs.get('id', [''])[0]
        if not raw or not raw.isdigit():
            return json_response(self, 400, {'error': 'Missing or invalid ?id= parameter.'})
        version_id = int(raw)

        sb = supabase_admin()
        if not sb:
            return json_response(self, 500, {'error': 'Supabase service key not configured.'})

        r = (sb.table('keystone_analysis_versions')
               .select('id, label, data_type, payload, created_at')
               .eq('id', version_id)
               .execute())
        if not r.data:
            return json_response(self, 404, {'error': 'Version not found.'})

        v       = r.data[0]
        payload = v['payload']

        if 'features' in payload:          # community_contact blob
            sb.table('keystone_dashboard_data').upsert(
                {'data_type': 'community_contact', 'payload': payload},
                on_conflict='data_type',
            ).execute()
            return json_response(self, 200, {
                'restored': True,
                'type':     'community_contact',
                'label':    v['label'],
                'points':   len(payload.get('features', [])),
            })

        if 'geojson' in payload:           # iaq_survey blob
            sb.table('keystone_dashboard_data').upsert(
                {'data_type': 'iaq_survey', 'payload': payload},
                on_conflict='data_type',
            ).execute()
            return json_response(self, 200, {
                'restored': True,
                'type':     'iaq_survey',
                'label':    v['label'],
                'points':   len(payload.get('geojson', {}).get('features', [])),
            })

        json_response(self, 400, {'error': 'Unknown payload format.'})
