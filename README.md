# FieldSurvey

Open SaaS for general spatial surveys. Each user creates one or more survey projects, invites a team, and collects geolocated points in the field via a mobile PWA. Each project has its own map, custom statuses, team, and dashboard.

**Status:** M1 (Foundation) — auth + projects + invites only. Field-collection and dashboard analytics ship in M2 and M3.

## Stack

- Next.js 15 (App Router) + TypeScript + React 19
- Tailwind CSS + shadcn/ui
- Supabase (Auth, Postgres, RLS, Realtime, Storage)
- Gmail SMTP via nodemailer (email)
- MapLibre GL JS (M2)
- Vercel hosting

## Quick start

```bash
cp .env.example .env.local   # paste your Supabase + Gmail App Password
npm install
npm run dev
```

See SETUP.md for full provisioning steps.

## Docs

- [docs/superpowers/specs/2026-05-21-fieldsurvey-design.md](docs/superpowers/specs/2026-05-21-fieldsurvey-design.md) — design specification
- [docs/superpowers/plans/2026-05-21-fieldsurvey-m1-foundation.md](docs/superpowers/plans/2026-05-21-fieldsurvey-m1-foundation.md) — M1 implementation plan
