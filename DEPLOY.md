# KeyStone — Deploy Guide (Supabase + Vercel)

No Render, no third host. The stack runs entirely on:

- **Supabase** — Postgres + Auth + Realtime + Storage
- **Vercel** — Static hosting (both dashboards) + Python Functions (runtime API) + Cron

## 1. Supabase setup

1. Create a new Supabase project.
2. Run each SQL file in `supabase/migrations/` in order via SQL Editor:
   - `01_keystone_field.sql` — field_survey_points, community_contacts, iaq_surveys, parcels, report_config
   - `02_keystone_dashboard_data.sql` — cached payload table
   - `03_analysis_versions.sql` — version history
   - `04_user_presence.sql` — last-active heartbeat
3. Verify Realtime is enabled for `field_survey_points` and `user_presence` under Database → Replication.
4. From Project Settings → API copy:
   - **SUPABASE_URL**
   - **SUPABASE_ANON_KEY** (public)
   - **SUPABASE_SERVICE_ROLE_KEY** (server-only)

## 2. Local ingestion (one-time + when source data changes)

The heavy spatial ingest (parcel GDB → GeoJSON, address/parcel STRtree join) runs
on your laptop where `geopandas`/`fiona` are already installed. Vercel never sees
these deps.

```bash
# Parcels (one-time or when the GDB updates)
python scripts/export_parcels_to_supabase.py

# Community contacts + IAQ surveys — the existing app.py upload endpoints still
# work locally:  uvicorn app:app --reload
# Upload via the Dashboard → Import modal (Step 1 then Step 2).
```

Each ingest writes a precomputed GeoJSON/analysis blob into
`keystone_dashboard_data` and a snapshot row into `keystone_analysis_versions`.
The Vercel Functions only read from those two tables at runtime.

## 3. Vercel deploy

1. Import the repo into Vercel (no framework preset; it's static + Python Functions).
2. Under Project Settings → Environment Variables add (from `.env.example`):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY` *(only needed once `/api/chat` is ported; see Gaps below)*
   - `CRON_SECRET` *(optional — protects `/api/daily-refresh`)*
3. Deploy.

### Routes (from root `vercel.json`)

| Path | Serves |
|---|---|
| `/` | Field PWA (`keystone_field_web/index.html`) |
| `/login` | Login screen |
| `/admin` | Admin console |
| `/dashboard` | Desktop dashboard (`static/index.html`) |
| `/api/config` | Public Supabase URL + anon key (never service role) |
| `/api/survey-points`, `/api/parcels`, `/api/analysis`, `/api/iaq-points`, `/api/iaq-analysis`, `/api/versions` | Read-only cached data |
| `/api/daily-refresh` | Cron-triggered merge (06:00 UTC daily) |

## 4. Verify after deploy

1. Open `/` — field PWA loads, prompts login.
2. Sign in → land on `/field`. Open `/dashboard` in another browser.
3. Add a point in the field PWA → desktop `/dashboard` shows it within ~1s (realtime).
4. On desktop, "Team" tab shows your name with `today=1` and `active now`.
5. Field PWA "Team" tab shows the same.
6. Turn the field PWA offline (DevTools → Network), add 3 points, go back online — banner clears, desktop receives all 3.
7. Hit `/api/daily-refresh` manually — response has `refreshed: true` with the new count.

## 5. Gaps / intentionally NOT on Vercel

The following were scoped out of the first deploy:

- **`/api/chat`** — Claude-powered AI survey analyst (streaming). Can be ported
  to `api/chat.py` with the `anthropic` SDK when needed. Vercel Python supports
  streaming responses.
- **`/api/upload/*`** — bulk data ingest. Runs locally via `app.py` + the
  Dashboard Import modal. If field users need to upload from the browser in
  production, port survey + IAQ uploads to `api/upload/survey.py` + `api/upload/iaq.py`
  using pure pandas (no geopandas). Parcel GDB ingest stays local.
- **`keystone_field_api/main.py`** — redundant with `app.py` for admin uploads.
  Remove once its endpoints are absorbed into `api/*.py` or `app.py`.

## 6. Operations

- **Rolling back data**: The `keystone_analysis_versions` table keeps snapshots.
  Restore a past version via the "History" button on the desktop dashboard.
- **Scheduled refresh**: `vercel.json` → `crons` runs `/api/daily-refresh` at 06:00 UTC.
- **Auth**: Supabase email/password, JWT stored client-side by the SDK.
- **RLS**: All tables have Row Level Security. Surveyors can only insert/update
  their own `field_survey_points`. Presence is self-write, read-all.
