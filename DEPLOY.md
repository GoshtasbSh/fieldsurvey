# Deploy

FieldSurvey is hosted on Vercel and backed by Supabase. Every push to `main` triggers an auto-deploy.

## Preview deploys

Any push to a non-`main` branch creates a Vercel preview URL. The preview shares the production Supabase project — be careful with destructive actions.

## Production deploy

```bash
vercel --prod
```

Or just push to `main`.

## Environment variables (production)

Set these in the Vercel project settings (Production + Preview + Development):

| Variable | Where to get it | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | **Secret.** Never expose to the client |
| `GMAIL_USER` | Dedicated Gmail account | Used as the email sender |
| `GMAIL_APP_PASSWORD` | Gmail App Passwords | 16 chars, no spaces |
| `EMAIL_FROM_NAME` | Free-form | Display name on outgoing mail (default: FieldSurvey) |
| `NEXT_PUBLIC_APP_URL` | e.g. `https://fieldsurvey.app` | Used in email links + OAuth redirects |
| `INTERNAL_API_SECRET` | `openssl rand -hex 32` | **Required for M3.** Gates the Python matcher (`/api/py/match_responses`) and the daily-digest cron. Without it, response matching and the cron 401 silently |

Generate the internal secret once and set it in all three environments:

```bash
SECRET=$(openssl rand -hex 32)
echo "$SECRET" | vercel env add INTERNAL_API_SECRET production
echo "$SECRET" | vercel env add INTERNAL_API_SECRET preview
echo "$SECRET" | vercel env add INTERNAL_API_SECRET development
```

## Database migrations

Migrations live in `supabase/migrations/`. Apply them to a fresh project in order:

```bash
# Pull project ref from .env.local or Supabase dashboard
PROJ=ykssihpinzbgmpylqtjl

# 001 + 002 + 003 must be applied in order on a fresh database
for f in supabase/migrations/00{1,2,3}_*.sql; do
  echo "→ $f"
  psql "postgresql://postgres:[PASSWORD]@db.${PROJ}.supabase.co:5432/postgres" -f "$f"
done
```

In dev, the easier path is the Supabase Dashboard → SQL Editor → paste each file in order. Migrations are idempotent (`if not exists` everywhere) so re-running is safe.

## Storage buckets

Migration 002 creates two storage buckets via SQL: `point-photos` (private) and `avatars` (public). If you provisioned the Supabase project before applying 002, verify both buckets exist in Dashboard → Storage and that the RLS policies on `storage.objects` from 002 are active.

## Cron job (M3)

The daily digest + cap-warning email job lives at `/api/cron/daily-digest`. Wired in `vercel.json`:

```json
{ "crons": [ { "path": "/api/cron/daily-digest", "schedule": "0 13 * * *" } ] }
```

Runs daily at 13:00 UTC. The route checks `x-cron-secret` against `INTERNAL_API_SECRET`; Vercel Cron automatically includes the header from the `CRON_SECRET` env if you set one — for now we use `INTERNAL_API_SECRET` since it's already shared with the Python matcher.

## Post-deploy verification

After every prod deploy:

1. Hit the home page → confirms Next.js + middleware are healthy
2. `curl -X POST https://your-app.vercel.app/api/points` → must return 401 (auth gate working)
3. Open any project on desktop → left-rail Match Status counts populate from `v_match_status_counts`
4. Open the same project on mobile → 3 tabs (Map / Team / More), FAB visible, no R1 glyphs

## Rollback

```bash
vercel rollback
```

Vercel keeps the last ~50 deployments. For a database schema rollback, write a new migration that reverses the change — never run `DROP TABLE` against production by hand.
