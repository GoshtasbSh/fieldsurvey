"""POST /api/upload/results — Survey results CSV/Excel upload on Vercel."""
from http.server import BaseHTTPRequestHandler
from pathlib import Path
import io

import sys
sys.path.append(str(Path(__file__).parent.parent))
from _lib import supabase_admin, supabase_anon, json_response
from _processing import parse_multipart_file

try:
    import pandas as pd
    _HAS_PANDAS = True
except ImportError:
    _HAS_PANDAS = False


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        ct     = self.headers.get('Content-Type', '')
        length = int(self.headers.get('Content-Length', 0))
        body   = self.rfile.read(length)

        filename, file_bytes = parse_multipart_file(ct, body)
        if not file_bytes:
            return json_response(self, 400, {'detail': 'No file received.'})

        if not _HAS_PANDAS:
            return json_response(self, 500, {'detail': 'pandas not available on this function.'})

        suf = Path(filename or '').suffix.lower()
        try:
            if suf == '.csv':
                df = pd.read_csv(io.BytesIO(file_bytes))
            else:
                df = pd.read_excel(io.BytesIO(file_bytes))
        except Exception as e:
            return json_response(self, 400, {'detail': f'Could not parse file: {e}'})

        payload = {
            'columns': list(df.columns),
            'rows':    df.fillna('').to_dict('records'),
            'count':   len(df),
        }

        sb = supabase_admin() or supabase_anon()
        if sb:
            sb.table('keystone_dashboard_data').upsert(
                {'data_type': 'survey_results', 'payload': payload},
                on_conflict='data_type',
            ).execute()

        json_response(self, 200, {
            'status':  'ok',
            'rows':    len(df),
            'columns': list(df.columns),
        })
