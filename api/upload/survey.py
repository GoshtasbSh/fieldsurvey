"""POST /api/upload/survey — Community contact Excel/CSV upload on Vercel.

Geocodes each address using the parcel index (output/parcels_keystone.geojson)
with Census API fallback — identical to app.py's process_survey().
Saves result to Supabase so the dashboard shows updated contacts.
"""
from http.server import BaseHTTPRequestHandler
from datetime import date
from pathlib import Path

import sys
sys.path.append(str(Path(__file__).parent.parent))
from _lib import supabase_admin, supabase_anon, json_response
from _processing import parse_multipart_file, load_parcel_index, process_survey_bytes


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        ct     = self.headers.get('Content-Type', '')
        length = int(self.headers.get('Content-Length', 0))
        body   = self.rfile.read(length)

        filename, file_bytes = parse_multipart_file(ct, body)
        if not file_bytes:
            return json_response(self, 400, {'detail': 'No file received.'})

        suf = Path(filename or '').suffix.lower()
        if suf not in ('.xlsx', '.xls', '.csv'):
            return json_response(self, 400, {
                'detail': 'Upload an Excel (.xlsx/.xls) or CSV file.'
            })

        sb = supabase_admin() or supabase_anon()
        if not sb:
            return json_response(self, 500, {'detail': 'Supabase not configured.'})

        try:
            parcel_idx = load_parcel_index()
        except Exception as e:
            return json_response(self, 500, {'detail': f'Parcel index build failed: {e}'})

        try:
            survey_data = process_survey_bytes(file_bytes, filename, parcel_idx)
        except Exception as e:
            return json_response(self, 400, {'detail': f'Processing failed: {e}'})

        n     = len(survey_data.get('features', []))
        today = date.today().isoformat()
        label = f'Vercel Upload {today} — {n} contacts · {filename}'

        sb.table('keystone_dashboard_data').upsert(
            {'data_type': 'community_contact', 'payload': survey_data},
            on_conflict='data_type',
        ).execute()
        sb.table('keystone_analysis_versions').insert({
            'data_type': 'community_contact',
            'payload':   survey_data,
            'label':     label,
            'n_points':  n,
        }).execute()

        json_response(self, 200, {
            'status':   'ok',
            'points':   n,
            'filename': filename,
        })
