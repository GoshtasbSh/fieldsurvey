"""POST /api/upload?type={iaq|survey|results} — admin-only upload pipeline.

Consolidates the three previous endpoints (api/upload/iaq.py, .../survey.py,
.../results.py) into a single Vercel function so we stay within the Hobby
plan's 12-function ceiling. Behavior per branch is unchanged:

  ?type=iaq     — Qualtrics IAQ CSV. Score formulas, 4-tier geocoding,
                  IAQ↔contact upgrade, field_survey_points status sweep.
  ?type=survey  — Community contact Excel/CSV. Geocoding + community_contacts
                  table mirror so the mobile field app stays in sync.
  ?type=results — Generic survey results CSV/Excel. PII_COLS stripped before
                  persisting under data_type='survey_results'.

Auth: admin role required (require_admin) for every branch — uploads
overwrite production data via the service-role key.
"""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone
from pathlib import Path
import io
import sys
import traceback

sys.path.append(str(Path(__file__).parent))
from _lib import (
    supabase_admin, supabase_anon, load_cached, json_response,
    require_admin, check_upload_size, merge_preserve_analysis,
)
from _processing import (
    parse_multipart_file, load_parcel_index,
    process_iaq_bytes, process_survey_bytes, compute_contact_analysis,
    _apply_iaq_to_field_features, PII_COLS,
)

try:
    import pandas as _pd
    _PD_PARSE_ERR = (_pd.errors.ParserError, _pd.errors.EmptyDataError)
    _HAS_PANDAS = True
except Exception:
    _PD_PARSE_ERR = ()
    _HAS_PANDAS = False


def _sync_community_contacts(sb, features: list) -> None:
    """Replace community_contacts rows so the mobile field app stays in sync.
    Insert-first / delete-orphans so a partial INSERT never empties the table."""
    if not features:
        return
    rows = []
    for f in features:
        p = f.get('properties', {})
        coords = f.get('geometry', {}).get('coordinates', [None, None])
        rows.append({
            'lon':             coords[0],
            'lat':             coords[1],
            'address':         p.get('address', ''),
            'status':          p.get('status', 'Unknown'),
            'status_detail':   p.get('status_detail') or None,
            'second_attempt': p.get('second_attempt') or None,
            'notes':           p.get('notes') or None,
            'survey_date':     p.get('date') or None,
            'street_name':     p.get('street_name', ''),
            'matched_address': p.get('matched_address') or None,
            'color':           p.get('color', '#9ca3af'),
        })
    try:
        batch = 500
        inserted_ids: list[int] = []
        for i in range(0, len(rows), batch):
            result = sb.table('community_contacts').insert(rows[i:i + batch]).execute()
            inserted_ids.extend(r['id'] for r in (result.data or []) if r.get('id'))
        if inserted_ids:
            sb.table('community_contacts').delete().not_.in_('id', inserted_ids).execute()
    except Exception as e:
        print(f'[upload/survey] community_contacts sync WARN {type(e).__name__}: {e}')


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            return self._dispatch()
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[upload] UNCAUGHT {type(e).__name__}: {e}\n{tb[:2000]}")
            return json_response(self, 500, {
                'detail': 'Internal server error during upload — check Vercel logs.',
            })

    # ── Dispatcher ──────────────────────────────────────────────────────
    def _dispatch(self):
        if require_admin(self) is None:
            return
        qs   = parse_qs(urlparse(self.path).query)
        kind = (qs.get('type', ['iaq'])[0] or 'iaq').lower()

        ct = self.headers.get('Content-Type', '')
        length = check_upload_size(self)
        if length is None:
            return
        body = self.rfile.read(length)
        ct_log = ct[:80].replace('\r', ' ').replace('\n', ' ')
        print(f"[upload/{kind}] start n_bytes={length} ct={ct_log}")

        filename, file_bytes = parse_multipart_file(ct, body)
        if not file_bytes:
            return json_response(self, 400, {'detail': 'No file received.'})

        if kind == 'iaq':
            return self._handle_iaq(filename, file_bytes)
        if kind == 'survey':
            return self._handle_survey(filename, file_bytes)
        if kind == 'results':
            return self._handle_results(filename, file_bytes)
        return json_response(self, 400, {'detail': f"Unknown ?type={kind!r}"})

    # ── IAQ ─────────────────────────────────────────────────────────────
    def _handle_iaq(self, filename: str, csv_bytes: bytes):
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
        print(f"[upload/iaq] contacts loaded n={len(contact_feats)}")
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
            print(f"[upload/iaq] parcel-index FAIL {type(e).__name__}: {e}\n{tb[:1500]}")
            return json_response(self, 500, {'detail': 'Could not load parcel index — check Vercel logs.'})

        try:
            geojson, analysis, streets, n_upgraded, failed_geocodes = process_iaq_bytes(
                csv_bytes, contact_feats, parcel_idx)
        except _PD_PARSE_ERR as e:
            print(f"[upload/iaq] pandas parse error: {e}")
            return json_response(self, 400, {
                'detail': 'Could not parse CSV. Re-export from Qualtrics as CSV (UTF-8).',
            })
        except ValueError as e:
            print(f"[upload/iaq] validation error: {e}")
            return json_response(self, 400, {'detail': str(e)})
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[upload/iaq] processing FAIL {type(e).__name__}: {e}\n{tb[:2000]}")
            return json_response(self, 500, {'detail': 'Processing failed — check Vercel logs.'})

        n     = len(geojson.get('features', []))
        today = datetime.now(timezone.utc).date().isoformat()
        print(f"[upload/iaq] processed n_features={n} n_upgraded={n_upgraded}")

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
            # compute_contact_analysis returns parcel_stats: {} (Vercel
            # can't run geopandas to recompute it). Merge with the
            # existing analysis blob so the Parcels tab stays populated
            # after every IAQ-triggered re-merge.
            contact_analysis = merge_preserve_analysis(contact_analysis)
            sb.table('keystone_dashboard_data').upsert(
                {'data_type': 'analysis', 'payload': contact_analysis},
                on_conflict='data_type',
            ).execute()

        # Upgrade live field_survey_points to Completed where IAQ matches.
        n_field_upgraded = 0
        iaq_feats = geojson.get('features', [])
        if iaq_feats:
            field_rows: list = []
            PAGE = 1000
            HARD_CAP = 100_000
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
                    print(f"[upload/iaq] field_survey_points pagination capped at {HARD_CAP}")
            except Exception as e:
                print(f"[upload/iaq] field_survey_points read failed: {e}")
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
                        print(f"[upload/iaq] bulk field-point upgrade failed n={len(upgraded_ids)}: {e}")
                if n_field_upgraded > 0:
                    try:
                        sb.table('keystone_analysis_versions').insert({
                            'data_type': 'field_survey',
                            'payload':   {'n_field_upgraded': n_field_upgraded},
                            'label':     (f'IAQ-merged {today} — {n_field_upgraded} field points completed · {filename}'),
                            'n_points':  n_field_upgraded,
                        }).execute()
                    except Exception as e:
                        print(f"[upload/iaq] version insert (field_survey) failed: {e}")

        n_streets = len([s for s, d in streets.items() if not d.get('insufficient_data')])
        if failed_geocodes:
            print(f"[upload/iaq] {len(failed_geocodes)} addresses failed geocoding: {failed_geocodes[:10]}")
        print(f"[upload/iaq] done n={n} streets={n_streets} field_upgraded={n_field_upgraded}")
        return json_response(self, 200, {
            'status':            'ok',
            'points':            n,
            'streets_analyzed':  n_streets,
            'mean_risk':         analysis.get('scores', {}).get('mean_risk', 0),
            'n_upgraded':        n_upgraded,
            'n_field_upgraded':  n_field_upgraded,
            'validation':        validation,
            'failed_geocodes':   failed_geocodes,
        })

    # ── Survey (community contacts) ────────────────────────────────────
    def _handle_survey(self, filename: str, file_bytes: bytes):
        suf = Path(filename or '').suffix.lower()
        if suf not in ('.xlsx', '.xls', '.csv'):
            return json_response(self, 400, {'detail': 'Upload an Excel (.xlsx/.xls) or CSV file.'})
        sb = supabase_admin() or supabase_anon()
        if not sb:
            return json_response(self, 500, {'detail': 'Supabase not configured.'})
        try:
            parcel_idx = load_parcel_index()
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[upload/survey] parcel-index FAIL {type(e).__name__}: {e}\n{tb[:1500]}")
            return json_response(self, 500, {'detail': 'Could not load parcel index — check Vercel logs.'})
        try:
            survey_data, failed_geocodes = process_survey_bytes(file_bytes, filename, parcel_idx)
        except ValueError as e:
            print(f"[upload/survey] validation error: {e}")
            return json_response(self, 400, {'detail': str(e)})
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[upload/survey] processing FAIL {type(e).__name__}: {e}\n{tb[:2000]}")
            return json_response(self, 500, {'detail': 'Processing failed — check Vercel logs.'})

        n     = len(survey_data.get('features', []))
        today = datetime.now(timezone.utc).date().isoformat()
        label = f'Vercel Upload {today} — {n} contacts · {filename}'
        print(f"[upload/survey] processed n={n}")

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
        contact_analysis = compute_contact_analysis(survey_data.get('features', []))
        # Same parcel-preservation merge as the IAQ branch — without
        # this, every survey CSV upload zeros out the Parcels tab on
        # the dashboard until scripts/ingest.py is rerun locally.
        contact_analysis = merge_preserve_analysis(contact_analysis)
        sb.table('keystone_dashboard_data').upsert(
            {'data_type': 'analysis', 'payload': contact_analysis},
            on_conflict='data_type',
        ).execute()
        _sync_community_contacts(sb, survey_data.get('features', []))

        if failed_geocodes:
            print(f"[upload/survey] {len(failed_geocodes)} addresses failed geocoding: {failed_geocodes[:10]}")
        return json_response(self, 200, {
            'status':          'ok',
            'points':          n,
            'filename':        filename,
            'failed_geocodes': failed_geocodes,
        })

    # ── Results (generic CSV/XLSX) ─────────────────────────────────────
    def _handle_results(self, filename: str, file_bytes: bytes):
        if not _HAS_PANDAS:
            return json_response(self, 500, {'detail': 'pandas not available on this function.'})
        suf = Path(filename or '').suffix.lower()
        try:
            if suf == '.csv':
                df = _pd.read_csv(io.BytesIO(file_bytes))
            else:
                df = _pd.read_excel(io.BytesIO(file_bytes))
        except Exception as e:
            return json_response(self, 400, {'detail': f'Could not parse file: {e}'})

        pii = [c for c in PII_COLS if c in df.columns]
        if pii:
            df = df.drop(columns=pii)

        payload = {
            'columns':     list(df.columns),
            'rows':        df.fillna('').to_dict('records'),
            'count':       len(df),
            'dropped_pii': pii,
        }

        sb = supabase_admin() or supabase_anon()
        if not sb:
            return json_response(self, 500, {'detail': 'Supabase not configured — data not saved.'})
        sb.table('keystone_dashboard_data').upsert(
            {'data_type': 'survey_results', 'payload': payload},
            on_conflict='data_type',
        ).execute()
        return json_response(self, 200, {
            'status':  'ok',
            'rows':    len(df),
            'columns': list(df.columns),
        })
