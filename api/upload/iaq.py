"""POST /api/upload/iaq — Qualtric IAQ CSV upload on Vercel.

Full processing parity with app.py:
  • Same score formulas (health, IAQ, structural)
  • Same 4-tier geocoding (GPS → parcel snap → address match → Census)
  • Same IAQ↔contact matching (upgrades contacts to Completed)
  • Upserts to Supabase → dashboard always shows the latest upload
"""
from http.server import BaseHTTPRequestHandler
from datetime import date
from pathlib import Path

import sys
sys.path.append(str(Path(__file__).parent.parent))
from _lib import supabase_admin, supabase_anon, load_cached, json_response
from _processing import (
    parse_multipart_file, load_parcel_index,
    process_iaq_bytes, compute_contact_analysis,
)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        ct     = self.headers.get('Content-Type', '')
        length = int(self.headers.get('Content-Length', 0))
        body   = self.rfile.read(length)

        filename, csv_bytes = parse_multipart_file(ct, body)
        if not csv_bytes:
            return json_response(self, 400, {'detail': 'No file received. Upload a CSV file.'})

        if Path(filename or '').suffix.lower() != '.csv':
            return json_response(self, 400, {
                'detail': (
                    f'Received a {Path(filename or "").suffix.upper() or "non-CSV"} file. '
                    'Please export from Qualtrics as CSV: '
                    'Data → Export & Import → Export Data → CSV format.'
                )
            })

        sb = supabase_admin() or supabase_anon()
        if not sb:
            return json_response(self, 500, {'detail': 'Supabase not configured.'})

        # Load current community contacts from Supabase (for matching)
        contact_blob  = load_cached('community_contact') or {}
        contact_feats = list(contact_blob.get('features', []))

        # Build parcel index from deployed output/parcels_keystone.geojson
        try:
            parcel_idx = load_parcel_index()
        except Exception as e:
            return json_response(self, 500, {'detail': f'Parcel index build failed: {e}'})

        try:
            geojson, analysis, streets, n_upgraded = process_iaq_bytes(
                csv_bytes, contact_feats, parcel_idx)
        except Exception as e:
            return json_response(self, 400, {'detail': f'Processing failed: {e}'})

        n       = len(geojson.get('features', []))
        today   = date.today().isoformat()
        payload = {
            'geojson':         geojson,
            'analysis':        analysis,
            'street_stats':    streets,
            'validation':      {},
            'source_filename': filename,
        }

        # Upsert iaq_survey — replaces previous upload so dashboard always shows latest
        sb.table('keystone_dashboard_data').upsert(
            {'data_type': 'iaq_survey', 'payload': payload},
            on_conflict='data_type',
        ).execute()
        sb.table('keystone_analysis_versions').insert({
            'data_type': 'iaq_survey',
            'payload':   payload,
            'label':     f'Vercel Upload {today} — {n} responses · {filename}',
            'n_points':  n,
        }).execute()

        # Persist upgraded community contacts (matched contacts → Completed)
        if n_upgraded and contact_feats:
            updated_contact = {**contact_blob, 'features': contact_feats}
            sb.table('keystone_dashboard_data').upsert(
                {'data_type': 'community_contact', 'payload': updated_contact},
                on_conflict='data_type',
            ).execute()
            sb.table('keystone_analysis_versions').insert({
                'data_type': 'community_contact',
                'payload':   updated_contact,
                'label':     f'IAQ-merged {today} — {n_upgraded} contacts upgraded · {filename}',
                'n_points':  len(contact_feats),
            }).execute()
            # Recompute and save analysis blob so dashboard stats panel reflects
            # the new Completed counts immediately (mirrors app.py's _sb_save('analysis',...))
            contact_analysis = compute_contact_analysis(contact_feats)
            sb.table('keystone_dashboard_data').upsert(
                {'data_type': 'analysis', 'payload': contact_analysis},
                on_conflict='data_type',
            ).execute()

        n_streets = len([s for s, d in streets.items() if not d.get('insufficient_data')])
        json_response(self, 200, {
            'status':          'ok',
            'points':          n,
            'streets_analyzed': n_streets,
            'mean_risk':       analysis.get('scores', {}).get('mean_risk', 0),
            'n_upgraded':      n_upgraded,
            'validation':      {},
        })
