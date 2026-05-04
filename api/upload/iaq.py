"""POST /api/upload/iaq — Qualtric IAQ CSV upload on Vercel.

Full processing parity with app.py:
  • Same score formulas (health, IAQ, structural)
  • Same 4-tier geocoding (GPS → parcel snap → address match → Census)
  • Same IAQ↔contact matching (upgrades contacts to Completed)
  • Upserts to Supabase → dashboard always shows the latest upload
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone
from pathlib import Path
import sys
import traceback

sys.path.append(str(Path(__file__).parent.parent))
from _lib import (
    supabase_admin, supabase_anon, load_cached, json_response,
    require_auth, check_upload_size,
)
from _processing import (
    parse_multipart_file, load_parcel_index,
    process_iaq_bytes, compute_contact_analysis,
    _apply_iaq_to_field_features,
)

try:
    import pandas as _pd
    _PD_PARSE_ERR = (_pd.errors.ParserError, _pd.errors.EmptyDataError)
except Exception:
    _PD_PARSE_ERR = ()


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            return self._handle()
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[iaq] UNCAUGHT {type(e).__name__}: {e}\n{tb[:2000]}")
            return json_response(self, 500, {
                'detail': 'Internal server error during upload — check Vercel logs.',
            })

    def _handle(self):
        # Authenticate first — only signed-in surveyors may overwrite production data.
        if require_auth(self) is None:
            return  # 401 already written
        ct = self.headers.get('Content-Type', '')
        length = check_upload_size(self)
        if length is None:
            return  # 4xx already written
        body = self.rfile.read(length)
        # Sanitize Content-Type for log (defense against newline injection)
        ct_log = ct[:80].replace('\r', ' ').replace('\n', ' ')
        print(f"[iaq] start n_bytes={length} ct={ct_log}")

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

        contact_blob  = load_cached('community_contact') or {}
        contact_feats = list(contact_blob.get('features', []))
        print(f"[iaq] contacts loaded n={len(contact_feats)}")

        # Without contacts the address-matching tier is skipped (only the 50 m
        # spatial fallback runs), which silently degrades match accuracy.
        # Match the local app's UX and require contacts first.
        if not contact_feats:
            return json_response(self, 400, {
                'detail': (
                    'No Community Contact data found. Upload the Community '
                    'Contact CSV/XLSX first, then re-upload the Qualtrics file.'
                ),
            })

        try:
            parcel_idx = load_parcel_index()
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[iaq] parcel-index FAIL {type(e).__name__}: {e}\n{tb[:1500]}")
            return json_response(self, 500, {
                'detail': 'Could not load parcel index — check Vercel logs.',
            })

        try:
            geojson, analysis, streets, n_upgraded, failed_geocodes = process_iaq_bytes(
                csv_bytes, contact_feats, parcel_idx)
        except _PD_PARSE_ERR as e:
            print(f"[iaq] pandas parse error: {e}")
            return json_response(self, 400, {
                'detail': 'Could not parse CSV. Re-export from Qualtrics as CSV (UTF-8).',
            })
        except ValueError as e:
            # ValueError messages are application-authored — safe to surface.
            print(f"[iaq] validation error: {e}")
            return json_response(self, 400, {'detail': str(e)})
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[iaq] processing FAIL {type(e).__name__}: {e}\n{tb[:2000]}")
            return json_response(self, 500, {
                'detail': 'Processing failed — check Vercel logs.',
            })

        n     = len(geojson.get('features', []))
        today = datetime.now(timezone.utc).date().isoformat()
        print(f"[iaq] processed n_features={n} n_upgraded={n_upgraded}")

        validation = analysis.get('validation_warnings', {}) or {}
        payload = {
            'geojson':         geojson,
            'analysis':        analysis,
            'street_stats':    streets,
            'validation':      validation,
            'source_filename': filename,
        }

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
            contact_analysis = compute_contact_analysis(contact_feats)
            sb.table('keystone_dashboard_data').upsert(
                {'data_type': 'analysis', 'payload': contact_analysis},
                on_conflict='data_type',
            ).execute()

        # ── Upgrade live field_survey_points in Supabase ─────────────────────
        n_field_upgraded = 0
        iaq_feats = geojson.get('features', [])
        if iaq_feats:
            # Paginate — PostgREST caps default SELECT at 1000 rows. Without
            # pagination, every field point past row 1000 is silently skipped.
            field_rows: list = []
            PAGE = 1000
            HARD_CAP = 100000
            offset = 0
            try:
                while offset < HARD_CAP:
                    page = (sb.table('field_survey_points')
                            .select('id, lat, lon, status')
                            .range(offset, offset + PAGE - 1)
                            .execute().data) or []
                    if not page:
                        break
                    field_rows.extend(page)
                    if len(page) < PAGE:
                        break
                    offset += PAGE
                if len(field_rows) >= HARD_CAP:
                    print(f"[iaq] field_survey_points pagination capped at {HARD_CAP}")
            except Exception as e:
                print(f"[iaq] field_survey_points read failed: {e}")
                field_rows = []

            if field_rows:
                field_feats = [
                    {
                        'type': 'Feature',
                        'geometry': {'type': 'Point',
                                     'coordinates': [r['lon'], r['lat']]},
                        'properties': {'field_point_id': r['id'],
                                       'status': r.get('status') or 'Unknown'},
                    }
                    for r in field_rows
                    if r.get('lon') is not None and r.get('lat') is not None
                ]

                n_field_upgraded = _apply_iaq_to_field_features(field_feats, iaq_feats)

                # One bulk UPDATE instead of N round-trips: at 30+ upgrades the
                # serial loop pushed past Vercel's function timeout.
                upgraded_ids = [
                    ff['properties']['field_point_id']
                    for ff in field_feats
                    if (ff['properties'].get('has_iaq_survey')
                        and ff['properties'].get('status') == 'Completed')
                ]
                if upgraded_ids:
                    try:
                        sb.table('field_survey_points').update(
                            {'status': 'Completed'}
                        ).in_('id', upgraded_ids).execute()
                    except Exception as e:
                        print(f"[iaq] bulk field-point upgrade failed "
                              f"n={len(upgraded_ids)}: {e}")

                if n_field_upgraded > 0:
                    try:
                        sb.table('keystone_analysis_versions').insert({
                            'data_type': 'field_survey',
                            'payload':   {'n_field_upgraded': n_field_upgraded},
                            'label':     (f'IAQ-merged {today} — '
                                          f'{n_field_upgraded} field points completed · {filename}'),
                            'n_points':  n_field_upgraded,
                        }).execute()
                    except Exception as e:
                        print(f"[iaq] version insert (field_survey) failed: {e}")

        n_streets = len([s for s, d in streets.items() if not d.get('insufficient_data')])
        if failed_geocodes:
            print(f"[iaq] {len(failed_geocodes)} addresses failed geocoding: {failed_geocodes[:10]}")
        print(f"[iaq] done n={n} streets={n_streets} field_upgraded={n_field_upgraded}")
        json_response(self, 200, {
            'status':            'ok',
            'points':            n,
            'streets_analyzed':  n_streets,
            'mean_risk':         analysis.get('scores', {}).get('mean_risk', 0),
            'n_upgraded':        n_upgraded,
            'n_field_upgraded':  n_field_upgraded,
            'validation':        validation,
            'failed_geocodes':   failed_geocodes,
        })
