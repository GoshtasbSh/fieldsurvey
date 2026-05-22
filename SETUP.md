# FieldSurvey Setup

These steps provision a fresh Supabase + Vercel + Gmail App Password for FieldSurvey. They are intentionally separate from the original KeyStone instances.

## 1. Supabase

1. https://supabase.com/dashboard → New project → name `fieldsurvey-prod`
2. Region: closest to your users
3. Save the DB password in a password manager
4. Project Settings → API → copy `URL`, `anon` key, `service_role` key
5. SQL Editor → paste `supabase/migrations/001_init.sql` → Run, OR use Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push --linked`
6. Storage → create bucket `avatars` (public) and `point-photos` (private)
7. Auth → Providers → Email: enable Email + Magic links

## 2. Vercel

1. `npm i -g vercel`
2. `vercel link` (Create new project → name `fieldsurvey`)
3. `vercel env add` for each: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `EMAIL_FROM_NAME`, `NEXT_PUBLIC_APP_URL`

## 3. Gmail App Password (for outbound email)

Same pattern as Keystone (`api/_email_logic.py::_send_via_gmail_smtp`).

1. Pick or create a dedicated Gmail account (e.g. `fieldsurvey-mail@gmail.com`) — recipients will see all outbound FieldSurvey mail as coming from this address.
2. Enable **2-Step Verification** at https://myaccount.google.com/security
3. Generate an App Password at https://myaccount.google.com/apppasswords (app name: "FieldSurvey"). Copy the 16-character string.
4. In `.env.local` and Vercel: `GMAIL_USER=<the gmail address>`, `GMAIL_APP_PASSWORD=<the 16-char password>`, `EMAIL_FROM_NAME=FieldSurvey` (optional).

## 4. Local

```bash
cp .env.example .env.local
# paste the values
npm install
npm run dev
```
