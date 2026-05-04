"""POST /api/upload/survey — Community contact Excel/CSV upload on Vercel.

Geocodes each address using the parcel index (output/parcels_keystone.geojson)
with Census API fallback — identical to app.py's process_survey().
Saves result to Supabase so the dashboard shows updated contacts.
"""
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone
from pathlib import Path
import sys
import traceback

sys.path.append(str(Path(__file__).parent.parent))
from _lib import (
    supabase_admin, supabase_anon, json_response,
    require_admin, check_upload_size,
)
from _processing import (
    parse_multipart_file, load_parcel_index,
    process_survey_bytes, compute_contact_analysis,
)


def _sync_community_contacts(sb, features: list) -> None:
    """Replace community_contacts table rows so the mobile field app stays in sync."""
    if not features:
        return
    rows = []
    for f in features:
        p      = f.get('properties', {})
        coords = f.get('geometry', {}).get('coordinates', [None, None])
        rows.append({
            'lon':             coords[0],
            'lat':             coords[1],
            'address':         p.get('address', ''),
            'status':          p.get('status', 'Unknown'),
            'status_detail':   p.get('status_detail') or None,
            'second_attempt':  p.get('second_attempt') or None,
            'notes':           p.get('notes') or None,
            'survey_date':     p.get('date') or None,
            'street_name':     p.get('street_name', ''),
            'matched_address': p.get('matched_address') or None,
            'color':           p.get('color', '#9ca3af'),
        })
    try:
        # Insert-first strategy: write new rows before deleting old ones so that
        # a partial INSERT failure never leaves the table empty (which would make
        # the mobile field app show no contact pins until the next upload).
        batch = 500
        inserted_ids: list[int] = []
        for i in range(0, len(rows), batch):
            result = sb.table('community_contacts').insert(rows[i:i + batch]).execute()
            inserted_ids.extend(r['id'] for r in (result.data or []) if r.get('id'))
        # Remove only the rows that were NOT part of this upload (orphaned old rows).
        if inserted_ids:
            sb.table('community_contacts').delete().not_.in_('id', inserted_ids).execute()
    except Exception as e:
        # Blob already saved — don't abort the request, just log.
        print(f'[survey] community_contacts sync WARN {type(e).__name__}: {e}')


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            return self._handle()
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[survey] UNCAUGHT {type(e).__name__}: {e}\n{tb[:2000]}")
            return json_response(self, 500, {
                'detail': 'Internal server error during upload — check Vercel logs.',
            })

    def _handle(self):
        # Admin-only: only project admins may overwrite production data.
        if require_admin(self) is None:
            return  # 401/403 already written
        ct = self.headers.get('Content-Type', '')
        length = check_upload_size(self)
        if length is None:
            return  # 4xx already written
        body = self.rfile.read(length)
        ct_log = ct[:80].replace('\r', ' ').replace('\n', ' ')
        print(f"[survey] start n_bytes={length} ct={ct_log}")

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
            tb = traceback.format_exc()
            print(f"[survey] parcel-index FAIL {type(e).__name__}: {e}\n{tb[:1500]}")
            return json_response(self, 500, {
                'detail': 'Could not load parcel index — check Vercel logs.',
            })

        try:
            survey_data, failed_geocodes = process_survey_bytes(file_bytes, filename, parcel_idx)
        except ValueError as e:
            print(f"[survey] validation error: {e}")
            return json_response(self, 400, {'detail': str(e)})
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[survey] processing FAIL {type(e).__name__}: {e}\n{tb[:2000]}")
            return json_response(self, 500, {
                'detail': 'Processing failed — check Vercel logs.',
            })

        n     = len(survey_data.get('features', []))
        today = datetime.now(timezone.utc).date().isoformat()
        label = f'Vercel Upload {today} — {n} contacts · {filename}'
        print(f"[survey] processed n={n}")

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
        sb.table('keystone_dashboard_data').upsert(
            {'data_type': 'analysis', 'payload': contact_analysis},
            on_conflict='data_type',
        ).execute()

        # Mirror to community_contacts table so the mobile field app can read it.
        _sync_community_contacts(sb, survey_data.get('features', []))

        if failed_geocodes:
            print(f"[survey] {len(failed_geocodes)} addresses failed geocoding: {failed_geocodes[:10]}")
        json_response(self, 200, {
            'status':          'ok',
            'points':          n,
            'filename':        filename,
            'failed_geocodes': failed_geocodes,
        })
