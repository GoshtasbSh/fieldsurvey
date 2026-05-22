# FieldSurvey M1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take this repo (currently a copy of KeyStone), wipe Keystone code, provision separate Supabase + Vercel infra, and stand up a Next.js 15 app where a person can sign up, create empty projects, invite teammates by email, and accept invites — with device auto-routing between desktop and mobile shells.

**Architecture:** Next.js 15 App Router monorepo (single `app/` tree serves both desktop and mobile via responsive layouts and a device-detection redirect). Supabase Postgres + Auth + RLS for data and identity. Gmail SMTP via nodemailer for transactional email. TypeScript everywhere. shadcn/ui + Tailwind for primitives.

**Tech Stack:** Next.js 15.x, React 19, TypeScript 5.x, Tailwind CSS 3.x, shadcn/ui, Supabase JS SDK v2, MapLibre GL JS 4.x, Lucide React, Gmail SMTP via nodemailer, Vitest, Playwright.

**Reference design spec:** `docs/superpowers/specs/2026-05-21-fieldsurvey-design.md`

---

## Phase A — Snapshot and wipe Keystone

### Task A1: Snapshot current Keystone state

**Files:**
- Create: `legacy/keystone-snapshot.zip`
- Modify: `.gitignore` (to whitelist the legacy zip)

- [ ] **Step 1: Verify clean working tree**

Run: `git status --short`
Expected: only the new spec file may show; otherwise empty. If dirty, commit or stash first.

- [ ] **Step 2: Create lightweight tag pointing at the current commit**

Run:
```bash
git tag legacy-keystone-snapshot
git tag --list legacy-keystone-snapshot
```
Expected output: `legacy-keystone-snapshot`

- [ ] **Step 3: Push the tag**

Run: `git push origin legacy-keystone-snapshot`
Expected: tag pushed successfully (or "everything up-to-date" if already pushed).

- [ ] **Step 4: Make legacy/ directory and zip Keystone artifacts into it**

Run:
```bash
mkdir -p legacy
zip -r legacy/keystone-snapshot.zip \
  app.py keystone_field_api keystone_field_web dashboard field login \
  static scripts supabase api index.html \
  AUDIT_PHASE3.md DEPLOY.md PARITY.md PHASE1_DEPLOY.md PI_PRESENTATION.md REVIEW_STATUS.md \
  mockups graphify-out output data tests \
  requirements.txt requirements-local.txt vercel.json .env.example .vercelignore \
  audit-*.png \
  2>/dev/null || true
ls -lh legacy/keystone-snapshot.zip
```
Expected: file exists, several MB in size.

- [ ] **Step 5: Commit the snapshot**

Run:
```bash
git add legacy/keystone-snapshot.zip
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
chore(legacy): snapshot Keystone v1 before FieldSurvey rewrite

Single archived copy of all Keystone-specific files (clients, API,
migrations, audit docs, mockups). Kept once in-repo so non-git users
can retrieve the previous app. Tag legacy-keystone-snapshot points
at this same commit. Future commits delete the loose files.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: commit created.

---

### Task A2: Hard-delete Keystone code

**Files:**
- Delete: `app.py`, `index.html`, `vercel.json`, `requirements.txt`, `requirements-local.txt`, `.vercelignore`, `.env`
- Delete: directories `keystone_field_api/`, `keystone_field_web/`, `dashboard/`, `field/`, `login/`, `static/`, `scripts/`, `api/`, `supabase/migrations/`, `supabase/functions/`, `mockups/`, `graphify-out/`, `output/`, `data/`, `tests/`, `.vercel/`, `.pytest_cache/`, `.venv/`, `venv/`, `__pycache__/`, `.playwright-mcp/`
- Delete: top-level audit docs `AUDIT_PHASE3.md`, `DEPLOY.md`, `PARITY.md`, `PHASE1_DEPLOY.md`, `PI_PRESENTATION.md`, `REVIEW_STATUS.md`
- Delete: all `audit-*.png` files
- Modify: `.gitignore`

- [ ] **Step 1: Inventory what will be deleted (dry-run)**

Run:
```bash
ls -1 | grep -E '^(app\.py|index\.html|vercel\.json|requirements.*\.txt|\.vercelignore|\.env|keystone_field_api|keystone_field_web|dashboard|field|login|static|scripts|api|mockups|graphify-out|output|data|tests|\.vercel|\.pytest_cache|\.venv|venv|__pycache__|\.playwright-mcp|AUDIT_PHASE3\.md|DEPLOY\.md|PARITY\.md|PHASE1_DEPLOY\.md|PI_PRESENTATION\.md|REVIEW_STATUS\.md|audit-.*\.png|~\$.*\.xlsx)$' || true
ls -1 supabase 2>/dev/null
```
Expected: a list of items confirming the targets exist.

- [ ] **Step 2: Delete loose files**

Run:
```bash
rm -f app.py index.html vercel.json requirements.txt requirements-local.txt .vercelignore .env
rm -f AUDIT_PHASE3.md DEPLOY.md PARITY.md PHASE1_DEPLOY.md PI_PRESENTATION.md REVIEW_STATUS.md
rm -f audit-*.png
rm -f '~$Community Survey Contact Data .xlsx'
```
Expected: no error output.

- [ ] **Step 3: Delete legacy directories**

Run:
```bash
rm -rf keystone_field_api keystone_field_web dashboard field login static scripts api
rm -rf supabase/migrations supabase/functions
rm -rf mockups graphify-out output data tests
rm -rf .vercel .pytest_cache .venv venv __pycache__ .playwright-mcp
```
Expected: no error output.

- [ ] **Step 4: Rewrite `.gitignore` with FieldSurvey-appropriate ignores**

Replace the file with:
```
# Dependencies
node_modules/
.pnp/
.pnp.js

# Build output
.next/
out/
dist/
build/

# Environment
.env
.env.local
.env*.local

# Vercel
.vercel/

# Python (for api/py/ functions only)
__pycache__/
*.py[cod]
.pytest_cache/
.venv/
venv/

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/
.idea/
*.swp

# Tests
coverage/
playwright-report/
test-results/

# Misc
*.log
```

- [ ] **Step 5: Verify only intended files remain**

Run: `ls -la`
Expected: should show only `.claude/`, `.git/`, `.gitignore`, `docs/`, `legacy/`, `supabase/` (empty parent dir is OK; can recreate), and nothing Keystone-specific.

- [ ] **Step 6: Commit the deletion**

Run:
```bash
git add -A
git -c commit.gpgsign=false commit -m "$(cat <<'EOF'
chore(rewrite): remove Keystone-specific code

Wipes Keystone clients (mobile PWA, desktop dashboard, FastAPI service),
all 22 Keystone Supabase migrations, audit docs, Plotly app.py, and
generated artifacts. Snapshot preserved in legacy/keystone-snapshot.zip
(previous commit) and at tag legacy-keystone-snapshot.

Starts a clean tree for the FieldSurvey v1 scaffold.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: large deletion commit succeeds.

---

## Phase B — External infrastructure provisioning (USER actions)

These steps are performed by the user in browser/CLI. The plan provides the exact instructions and follow-up verification.

### Task B1: Create new Supabase project

**Files:** none (external service)

- [ ] **Step 1: User signs into supabase.com and creates a new project**

Instructions to give the user:
1. Open https://supabase.com/dashboard
2. Click **New project**
3. Name: `fieldsurvey-prod`
4. Region: closest to expected user base (e.g. `us-east-1` for the eastern US)
5. Generate a strong DB password and **save it to a password manager**
6. Click Create. Wait ~2 minutes for provisioning.

- [ ] **Step 2: User copies three secrets**

From the new Supabase project: **Project Settings → API**.
Copy and provide back to the agent (or write into `.env.local` directly):
- `Project URL` → goes into `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` key → goes into `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` key (KEEP SECRET) → goes into `SUPABASE_SERVICE_ROLE_KEY`

- [ ] **Step 3: User enables required Postgres extensions**

In Supabase SQL editor, run:
```sql
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";
```
Expected: both extensions enabled. (PostGIS is optional for v1; defer.)

- [ ] **Step 4: User creates two Storage buckets via dashboard**

In Storage:
1. Create bucket `avatars` — public — file size limit 5 MB
2. Create bucket `point-photos` — private — file size limit 10 MB

- [ ] **Step 5: User enables Email/Password and Magic Link in Auth → Providers**

Auth → Providers → Email: ensure **Enable Email Provider** is on, with both **Email confirmation** and **Magic links** enabled.

---

### Task B2: Create new Vercel project

**Files:** none (external service)

- [ ] **Step 1: User installs Vercel CLI if not installed**

Run: `npm i -g vercel`
Verify: `vercel --version` returns a version number.

- [ ] **Step 2: User runs `vercel link` from this directory**

Run: `vercel link`
Choose: **Create new project** (do NOT select the old Keystone project) → name `fieldsurvey`.
This creates a fresh `.vercel/project.json`.

- [ ] **Step 3: User adds environment variables to Vercel**

Run:
```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add GMAIL_USER
vercel env add GMAIL_APP_PASSWORD
vercel env add EMAIL_FROM_NAME
vercel env add NEXT_PUBLIC_APP_URL
```
For each: paste value, choose "Production, Preview, Development". `NEXT_PUBLIC_APP_URL` is `http://localhost:3000` for Development and the Vercel preview/production URL for the others.

---

### Task B3: Generate Gmail App Password

**Files:** none (external service)

Uses the same pattern as Keystone (`api/_email_logic.py::_send_via_gmail_smtp`). A dedicated Gmail account becomes the canonical FieldSurvey sender; we authenticate to `smtp.gmail.com:587` with a 16-character App Password.

- [ ] **Step 1: User creates / picks the dedicated Gmail account**

Use a dedicated Gmail address (e.g. `fieldsurvey-mail@gmail.com`) — NOT your personal one. Recipients will see `"FieldSurvey" <that-address@gmail.com>` on every outbound mail. Sign into that account in the browser.

- [ ] **Step 2: User enables 2-Step Verification**

https://myaccount.google.com/security → 2-Step Verification → ON. Required before App Passwords can be generated.

- [ ] **Step 3: User generates the App Password**

https://myaccount.google.com/apppasswords → enter app name `FieldSurvey` → Create → copy the 16-char string Google shows. Paste into `.env.local`:
- `GMAIL_USER=<the dedicated gmail address>`
- `GMAIL_APP_PASSWORD=<the 16-char app password>` (spaces are stripped by our code)

Optional: set `EMAIL_FROM_NAME=FieldSurvey` (display name on outbound mail). Defaults to "FieldSurvey" if omitted.

---

### Task B4: Populate local `.env.local`

**Files:**
- Create: `.env.local` (gitignored)
- Create: `.env.example` (committed)

- [ ] **Step 1: Create `.env.local` with the captured values**

The user writes this file at the project root:
```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
GMAIL_USER=<dedicated-gmail-address>
GMAIL_APP_PASSWORD=<16-char-app-password>
EMAIL_FROM_NAME=FieldSurvey
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 2: Create `.env.example` template**

Create file `.env.example`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GMAIL_USER=
GMAIL_APP_PASSWORD=
EMAIL_FROM_NAME=FieldSurvey
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 3: Commit `.env.example`**

Run:
```bash
git add .env.example
git -c commit.gpgsign=false commit -m "chore: add .env.example template

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase C — Next.js 15 scaffold

### Task C1: Initialize package.json and Next.js 15

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `postcss.config.mjs`, `tailwind.config.ts`

- [ ] **Step 1: Initialize Next.js 15 with App Router, TypeScript, Tailwind**

Run:
```bash
npx create-next-app@15 . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir=false \
  --import-alias='@/*' \
  --use-npm \
  --no-turbopack
```
When prompted to use existing files, answer **Yes** (we want to overlay).

Expected: `package.json`, `app/`, `tsconfig.json`, etc. created.

- [ ] **Step 2: Verify scaffold runs**

Run:
```bash
npm run dev &
sleep 4
curl -s http://localhost:3000 | head -20
kill %1
```
Expected: HTML response with `Next.js` markers.

- [ ] **Step 3: Replace `app/page.tsx` with a minimal FieldSurvey landing placeholder**

Replace contents with:
```tsx
export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">FieldSurvey</h1>
        <p className="mt-2 text-sm text-neutral-400">Scaffold up.</p>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Commit**

Run:
```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(scaffold): bootstrap Next.js 15 App Router + Tailwind

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C2: Install runtime dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install Supabase JS, MapLibre, Lucide, nodemailer, zod, date-fns**

Run:
```bash
npm install \
  @supabase/supabase-js@^2 \
  @supabase/ssr@^0.5 \
  maplibre-gl@^4.7 \
  lucide-react@^0.471 \
  nodemailer@^6 \
  zod@^3.23 \
  date-fns@^4 \
  clsx@^2 \
  tailwind-merge@^2
npm install -D @types/nodemailer@^6
```

- [ ] **Step 2: Install dev dependencies for tests**

Run:
```bash
npm install -D \
  vitest@^2 \
  @vitejs/plugin-react@^4 \
  @testing-library/react@^16 \
  @testing-library/jest-dom@^6 \
  jsdom@^25 \
  @playwright/test@^1.50
npx playwright install --with-deps chromium
```

- [ ] **Step 3: Commit**

Run:
```bash
git add package.json package-lock.json
git -c commit.gpgsign=false commit -m "feat(deps): add Supabase, MapLibre, nodemailer (Gmail SMTP), Vitest, Playwright

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C3: Initialize shadcn/ui

**Files:**
- Create: `components.json`, `components/ui/*` (button, dialog, input, label, dropdown-menu, sheet, tabs, toast, sonner, card)
- Modify: `tailwind.config.ts`, `app/globals.css`

- [ ] **Step 1: Run the shadcn init wizard**

Run:
```bash
npx shadcn@latest init -y --base-color slate --css-variables true
```
Expected: writes `components.json`, updates `tailwind.config.ts`, updates `app/globals.css` with CSS variables for dark/light themes.

- [ ] **Step 2: Install the initial component set we need for M1**

Run:
```bash
npx shadcn@latest add -y \
  button input label card dialog sheet \
  dropdown-menu tabs sonner separator avatar \
  alert form select
```

- [ ] **Step 3: Verify build still works**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

Run:
```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(ui): initialize shadcn/ui + install primitives

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C4: Configure design tokens and fonts

**Files:**
- Modify: `app/globals.css`, `app/layout.tsx`

- [ ] **Step 1: Update `app/globals.css` to set dark mode default and FieldSurvey accent**

Append/replace the `:root` and `.dark` blocks with FieldSurvey tokens (keep shadcn's existing variables, override only the accent and background):
```css
:root {
  --background: 220 13% 9%;   /* #0d1117 */
  --foreground: 213 31% 91%;  /* #e6edf3 */
  --card: 215 14% 11%;        /* #161b22 */
  --card-foreground: 213 31% 91%;
  --popover: 215 14% 11%;
  --popover-foreground: 213 31% 91%;
  --primary: 199 89% 60%;     /* #38bdf8 — sky-400 */
  --primary-foreground: 220 13% 9%;
  --secondary: 217 13% 17%;   /* #21262d */
  --secondary-foreground: 213 31% 91%;
  --muted: 217 13% 17%;
  --muted-foreground: 215 10% 58%;
  --accent: 199 89% 60%;
  --accent-foreground: 220 13% 9%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 213 31% 91%;
  --border: 220 13% 18%;
  --input: 220 13% 18%;
  --ring: 199 89% 60%;
  --radius: 0.625rem;
}

html { color-scheme: dark; }
html, body { background: hsl(var(--background)); color: hsl(var(--foreground)); }
```

- [ ] **Step 2: Load fonts in `app/layout.tsx`**

Replace `app/layout.tsx` with:
```tsx
import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Inter, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["400", "500", "600", "700", "800"],
});
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "FieldSurvey",
  description: "Run spatial surveys with your team.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${inter.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Wire fonts into Tailwind**

Edit `tailwind.config.ts` and inside `theme.extend`, add:
```ts
fontFamily: {
  sans: ["var(--font-inter)", "system-ui", "sans-serif"],
  display: ["var(--font-jakarta)", "system-ui", "sans-serif"],
  mono: ["var(--font-mono)", "ui-monospace", "monospace"],
},
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

Run:
```bash
git add app/globals.css app/layout.tsx tailwind.config.ts
git -c commit.gpgsign=false commit -m "feat(ui): set FieldSurvey dark theme + Plus Jakarta/Inter/Plex Mono fonts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C5: Configure Vitest

**Files:**
- Create: `vitest.config.ts`, `tests/setup.ts`
- Modify: `package.json`

- [ ] **Step 1: Create `vitest.config.ts`**

Write:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/playwright/**"],
  },
});
```

- [ ] **Step 2: Create `tests/setup.ts`**

Write:
```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Add scripts to `package.json`**

Under `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest",
"typecheck": "tsc --noEmit",
"e2e": "playwright test"
```

- [ ] **Step 4: Run vitest with no tests yet to confirm it starts**

Run: `npm run test`
Expected: "No test files found" — exit 0. Confirms Vitest works.

- [ ] **Step 5: Commit**

Run:
```bash
git add vitest.config.ts tests/setup.ts package.json
git -c commit.gpgsign=false commit -m "test: configure Vitest with jsdom + @testing-library

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C6: Configure Playwright

**Files:**
- Create: `playwright.config.ts`, `playwright/.gitkeep`

- [ ] **Step 1: Create `playwright.config.ts`**

Write:
```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
```

- [ ] **Step 2: Create empty `playwright/` directory with a `.gitkeep`**

Run: `mkdir -p playwright && touch playwright/.gitkeep`

- [ ] **Step 3: Verify Playwright config loads**

Run: `npx playwright test --list`
Expected: "0 tests in 0 files" — exit 0.

- [ ] **Step 4: Commit**

Run:
```bash
git add playwright.config.ts playwright/
git -c commit.gpgsign=false commit -m "test: configure Playwright E2E harness

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase D — Supabase schema and client wiring

### Task D1: Author migration `001_init.sql`

**Files:**
- Create: `supabase/migrations/001_init.sql`

- [ ] **Step 1: Write the migration**

Create file `supabase/migrations/001_init.sql`:
```sql
-- FieldSurvey M1 init: profiles, projects, members, invites, statuses, settings

create extension if not exists "pgcrypto";

-- profiles -----------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_self_read"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

create policy "profiles_share_member_read"
  on public.profiles for select to authenticated
  using (exists (
    select 1
    from public.project_members me
    join public.project_members other on other.project_id = me.project_id
    where me.user_id = auth.uid() and other.user_id = profiles.id
  ));

create policy "profiles_self_update"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- Auto-create profile row on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- projects -----------------------------------------------------------------
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles(id) on delete restrict,
  name         text not null check (char_length(name) between 1 and 80),
  description  text check (description is null or char_length(description) <= 1000),
  center_lat   double precision not null,
  center_lon   double precision not null,
  default_zoom integer not null default 14 check (default_zoom between 1 and 22),
  visibility   text not null default 'private' check (visibility in ('private','public_read')),
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_projects_owner on public.projects(owner_id);
create index if not exists idx_projects_visibility on public.projects(visibility);

alter table public.projects enable row level security;

-- project_members ----------------------------------------------------------
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('owner','admin','surveyor','viewer')),
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists idx_pm_user on public.project_members(user_id);

alter table public.project_members enable row level security;

-- Helper functions ---------------------------------------------------------
create or replace function public.is_project_member(p_project uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = auth.uid()
  );
$$;

create or replace function public.project_role(p_project uuid)
returns text language sql security definer stable set search_path = public as $$
  select role from public.project_members
  where project_id = p_project and user_id = auth.uid();
$$;

create or replace function public.is_public_project(p_project uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.projects where id = p_project and visibility = 'public_read'
  );
$$;

-- projects RLS -------------------------------------------------------------
create policy "projects_read_members_or_public"
  on public.projects for select
  using (
    public.is_project_member(id)
    or visibility = 'public_read'
  );

create policy "projects_insert_authenticated"
  on public.projects for insert to authenticated
  with check (owner_id = auth.uid());

create policy "projects_update_admin"
  on public.projects for update to authenticated
  using (public.project_role(id) in ('owner','admin'))
  with check (public.project_role(id) in ('owner','admin'));

create policy "projects_delete_owner"
  on public.projects for delete to authenticated
  using (public.project_role(id) = 'owner');

-- Make owner a member automatically
create or replace function public.add_owner_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_project_owner_membership on public.projects;
create trigger trg_project_owner_membership
  after insert on public.projects
  for each row execute function public.add_owner_membership();

-- project_members RLS ------------------------------------------------------
create policy "pm_read_members"
  on public.project_members for select
  using (public.is_project_member(project_id));

create policy "pm_insert_admin"
  on public.project_members for insert to authenticated
  with check (public.project_role(project_id) in ('owner','admin'));

create policy "pm_update_admin"
  on public.project_members for update to authenticated
  using (public.project_role(project_id) in ('owner','admin'))
  with check (public.project_role(project_id) in ('owner','admin'));

create policy "pm_delete_admin"
  on public.project_members for delete to authenticated
  using (public.project_role(project_id) in ('owner','admin'));

-- project_invites ----------------------------------------------------------
create table if not exists public.project_invites (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  email       text not null check (char_length(email) <= 255),
  role        text not null check (role in ('admin','surveyor','viewer')),
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by  uuid not null references public.profiles(id),
  expires_at  timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_invites_token on public.project_invites(token);
create index if not exists idx_invites_email on public.project_invites(lower(email));

alter table public.project_invites enable row level security;

create policy "invites_read_admin"
  on public.project_invites for select to authenticated
  using (public.project_role(project_id) in ('owner','admin'));

create policy "invites_insert_admin"
  on public.project_invites for insert to authenticated
  with check (public.project_role(project_id) in ('owner','admin') and invited_by = auth.uid());

create policy "invites_update_admin"
  on public.project_invites for update to authenticated
  using (public.project_role(project_id) in ('owner','admin'));

create policy "invites_delete_admin"
  on public.project_invites for delete to authenticated
  using (public.project_role(project_id) in ('owner','admin'));

-- Accept-invite RPC: validates token, inserts membership, marks accepted
create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_invite public.project_invites%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into v_invite from public.project_invites
    where token = p_token and accepted_at is null and expires_at > now()
    for update;

  if not found then
    raise exception 'invalid_or_expired_invite' using errcode = '22023';
  end if;

  if lower(v_invite.email) <> lower(v_email) then
    raise exception 'invite_email_mismatch' using errcode = '22023';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (v_invite.project_id, auth.uid(), v_invite.role)
  on conflict (project_id, user_id) do nothing;

  update public.project_invites set accepted_at = now() where id = v_invite.id;
  return v_invite.project_id;
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;

-- project_statuses ---------------------------------------------------------
create table if not exists public.project_statuses (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  label      text not null check (char_length(label) between 1 and 40),
  color      text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon       text,
  sort_order integer not null default 0,
  is_default boolean not null default false
);

create index if not exists idx_statuses_project on public.project_statuses(project_id);

alter table public.project_statuses enable row level security;

create policy "statuses_read_members_or_public"
  on public.project_statuses for select
  using (public.is_project_member(project_id) or public.is_public_project(project_id));

create policy "statuses_write_admin"
  on public.project_statuses for all to authenticated
  using (public.project_role(project_id) in ('owner','admin'))
  with check (public.project_role(project_id) in ('owner','admin'));

-- Seed default statuses on project create
create or replace function public.seed_default_statuses()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_statuses (project_id, label, color, icon, sort_order, is_default) values
    (new.id, 'Completed',     '#34d399', 'check-circle',    1, true),
    (new.id, 'No Answer',     '#f59e0b', 'door-closed',     2, false),
    (new.id, 'Inaccessible',  '#9ca3af', 'ban',             3, false),
    (new.id, 'Not Interested','#ef4444', 'x-circle',        4, false),
    (new.id, 'Follow Up',     '#38bdf8', 'rotate-cw',       5, false),
    (new.id, 'Other',         '#a78bfa', 'circle-help',     6, false);
  return new;
end;
$$;

drop trigger if exists trg_seed_statuses on public.projects;
create trigger trg_seed_statuses
  after insert on public.projects
  for each row execute function public.seed_default_statuses();

-- project_settings ---------------------------------------------------------
create table if not exists public.project_settings (
  project_id              uuid primary key references public.projects(id) on delete cascade,
  external_survey_url     text,
  qualtrics_survey_id     text,
  qualtrics_match_field   text default 'address' check (qualtrics_match_field in ('address','street_name','point_id')),
  updated_at              timestamptz not null default now()
);

alter table public.project_settings enable row level security;

create policy "settings_read_members_or_public"
  on public.project_settings for select
  using (public.is_project_member(project_id) or public.is_public_project(project_id));

create policy "settings_write_admin"
  on public.project_settings for all to authenticated
  using (public.project_role(project_id) in ('owner','admin'))
  with check (public.project_role(project_id) in ('owner','admin'));

-- Seed empty settings row on project create
create or replace function public.seed_project_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_settings (project_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists trg_seed_settings on public.projects;
create trigger trg_seed_settings
  after insert on public.projects
  for each row execute function public.seed_project_settings();

-- updated_at trigger -------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_projects_touch on public.projects;
create trigger trg_projects_touch
  before update on public.projects
  for each row execute function public.touch_updated_at();
```

- [ ] **Step 2: User runs the migration in Supabase**

Instructions to give the user:
1. Open Supabase Dashboard → SQL Editor → New query
2. Paste the entire contents of `supabase/migrations/001_init.sql`
3. Click **Run**
4. Expected: "Success. No rows returned."
5. Verify by going to Table Editor — `profiles`, `projects`, `project_members`, `project_invites`, `project_statuses`, `project_settings` should appear.

- [ ] **Step 3: Commit**

Run:
```bash
git add supabase/migrations/001_init.sql
git -c commit.gpgsign=false commit -m "feat(db): add 001_init migration with profiles/projects/members/invites/statuses/settings + RLS

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D2: Generate TypeScript types from Supabase schema

**Files:**
- Create: `lib/db.types.ts`

- [ ] **Step 1: Install Supabase CLI if not installed**

Run: `npm install -D supabase`
Verify: `npx supabase --version` returns a version.

- [ ] **Step 2: Login and link the project**

Run:
```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
```
(`<your-project-ref>` is the part before `.supabase.co` in your URL.)

- [ ] **Step 3: Generate types**

Run:
```bash
npx supabase gen types typescript --linked > lib/db.types.ts
```
Expected: file written containing `Database` type and all table row/insert/update types.

- [ ] **Step 4: Add a script to `package.json` for regeneration**

Add under `"scripts"`:
```json
"db:types": "supabase gen types typescript --linked > lib/db.types.ts"
```

- [ ] **Step 5: Commit**

Run:
```bash
git add lib/db.types.ts package.json package-lock.json
git -c commit.gpgsign=false commit -m "feat(db): generate TypeScript types from Supabase schema

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D3: Wire Supabase clients (browser, server, service)

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/admin.ts`
- Create: `middleware.ts`
- Test: `lib/supabase/client.test.ts`

- [ ] **Step 1: Write the failing test for the browser client**

Create `lib/supabase/client.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
});

describe("createBrowserSupabase", () => {
  it("returns a client with auth and from() available", async () => {
    const { createBrowserSupabase } = await import("./client");
    const client = createBrowserSupabase();
    expect(typeof client.auth.getSession).toBe("function");
    expect(typeof client.from).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- lib/supabase/client.test.ts`
Expected: FAIL with "Cannot find module './client'".

- [ ] **Step 3: Implement `lib/supabase/client.ts`**

```ts
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db.types";

export function createBrowserSupabase() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- lib/supabase/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `lib/supabase/server.ts`** (SSR client with cookie sync)

Create:
```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/db.types";

export async function createServerSupabase() {
  const store = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (toSet) => {
          for (const { name, value, options } of toSet) {
            store.set(name, value, options);
          }
        },
      },
    },
  );
}
```

- [ ] **Step 6: Implement `lib/supabase/admin.ts`** (service-role, server-only)

Create:
```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db.types";

export function createAdminSupabase() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
```

- [ ] **Step 7: Add Next.js middleware for cookie refresh**

Create `middleware.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookies.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
```

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

Run:
```bash
git add lib/supabase/ middleware.ts
git -c commit.gpgsign=false commit -m "feat(supabase): browser/server/admin clients + session-refresh middleware

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase E — Auth pages

### Task E1: Sign-up page

**Files:**
- Create: `app/(auth)/sign-up/page.tsx`, `app/(auth)/sign-up/actions.ts`, `app/(auth)/layout.tsx`
- Test: `playwright/auth-signup.spec.ts`

- [ ] **Step 1: Write the failing E2E test**

Create `playwright/auth-signup.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("sign-up page renders form fields", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test playwright/auth-signup.spec.ts`
Expected: FAIL — page returns 404.

- [ ] **Step 3: Create the auth layout shell**

Create `app/(auth)/layout.tsx`:
```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
```

- [ ] **Step 4: Create the sign-up action**

Create `app/(auth)/sign-up/actions.ts`:
```ts
"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  displayName: z.string().min(1).max(80).optional(),
});

export type SignUpResult = { error?: string };

export async function signUpAction(formData: FormData): Promise<SignUpResult> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName") || undefined,
  });
  if (!parsed.success) return { error: "Please enter a valid email and a password (8+ chars)." };

  const sb = await createServerSupabase();
  const { error } = await sb.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });
  if (error) return { error: error.message };
  redirect("/sign-up/check-email");
}
```

- [ ] **Step 5: Create the sign-up page**

Create `app/(auth)/sign-up/page.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { signUpAction } from "./actions";
import Link from "next/link";

export default function SignUpPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">Create your account</CardTitle>
      </CardHeader>
      <form
        action={(fd) => startTransition(async () => {
          const res = await signUpAction(fd);
          if (res?.error) setError(res.error);
        })}
      >
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="displayName">Name</Label>
            <Input id="displayName" name="displayName" placeholder="Ada Lovelace" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Creating..." : "Create account"}
          </Button>
          <p className="text-sm text-muted-foreground">
            Already have one? <Link href="/sign-in" className="underline">Sign in</Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
```

- [ ] **Step 6: Create the "check email" confirmation page**

Create `app/(auth)/sign-up/check-email/page.tsx`:
```tsx
export default function CheckEmailPage() {
  return (
    <div className="text-center">
      <h1 className="font-display text-2xl">Check your email</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We sent a confirmation link to your inbox. Click it to finish signing up.
      </p>
    </div>
  );
}
```

- [ ] **Step 7: Run the E2E test to verify it passes**

Run: `npx playwright test playwright/auth-signup.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

Run:
```bash
git add app/\(auth\)/ playwright/auth-signup.spec.ts
git -c commit.gpgsign=false commit -m "feat(auth): sign-up page + server action + check-email screen

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task E2: Sign-in page

**Files:**
- Create: `app/(auth)/sign-in/page.tsx`, `app/(auth)/sign-in/actions.ts`
- Test: `playwright/auth-signin.spec.ts`

- [ ] **Step 1: Write the failing E2E test**

Create `playwright/auth-signin.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("sign-in page renders form fields", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /create.*account/i })).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test playwright/auth-signin.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Create sign-in action**

Create `app/(auth)/sign-in/actions.ts`:
```ts
"use server";
import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { z } from "zod";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function signInAction(formData: FormData) {
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  const sb = await createServerSupabase();
  const { error } = await sb.auth.signInWithPassword(parsed.data);
  if (error) return { error: error.message };
  redirect("/home");
}

export async function magicLinkAction(formData: FormData) {
  const email = String(formData.get("email") || "");
  if (!email) return { error: "Enter your email." };
  const sb = await createServerSupabase();
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
  });
  if (error) return { error: error.message };
  return { ok: true };
}
```

- [ ] **Step 4: Create sign-in page**

Create `app/(auth)/sign-in/page.tsx`:
```tsx
"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { signInAction, magicLinkAction } from "./actions";

export default function SignInPage() {
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">Sign in</CardTitle>
      </CardHeader>
      <form
        action={(fd) => startTransition(async () => {
          const r = await signInAction(fd);
          if (r?.error) setError(r.error);
        })}
      >
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {magicSent && <p className="text-sm text-emerald-400">Magic link sent. Check your inbox.</p>}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button type="submit" className="w-full" disabled={pending}>{pending ? "Signing in..." : "Sign in"}</Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={pending}
            onClick={(e) => {
              const form = e.currentTarget.closest("form")!;
              const fd = new FormData(form);
              startTransition(async () => {
                const r = await magicLinkAction(fd);
                if (r?.error) setError(r.error);
                if (r?.ok) setMagicSent(true);
              });
            }}
          >
            Send magic link instead
          </Button>
          <div className="flex w-full justify-between text-sm text-muted-foreground">
            <Link href="/sign-up" className="underline">Create an account</Link>
            <Link href="/reset-password" className="underline">Forgot password?</Link>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}
```

- [ ] **Step 5: Run the E2E test**

Run: `npx playwright test playwright/auth-signin.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

Run:
```bash
git add app/\(auth\)/sign-in playwright/auth-signin.spec.ts
git -c commit.gpgsign=false commit -m "feat(auth): sign-in page with password + magic link

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task E3: Auth callback + reset password

**Files:**
- Create: `app/auth/callback/route.ts`, `app/(auth)/reset-password/page.tsx`, `app/(auth)/reset-password/actions.ts`

- [ ] **Step 1: Create the OAuth/magic-link callback route**

Create `app/auth/callback/route.ts`:
```ts
import { createServerSupabase } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/home";

  if (code) {
    const sb = await createServerSupabase();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, req.url));
  }
  return NextResponse.redirect(new URL("/sign-in?error=callback", req.url));
}
```

- [ ] **Step 2: Create reset-password action**

Create `app/(auth)/reset-password/actions.ts`:
```ts
"use server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function resetPasswordAction(formData: FormData) {
  const email = String(formData.get("email") || "");
  if (!email.includes("@")) return { error: "Enter a valid email." };
  const sb = await createServerSupabase();
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/account`,
  });
  if (error) return { error: error.message };
  return { ok: true };
}
```

- [ ] **Step 3: Create reset-password page**

Create `app/(auth)/reset-password/page.tsx`:
```tsx
"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { resetPasswordAction } from "./actions";

export default function ResetPasswordPage() {
  const [msg, setMsg] = useState<{ ok?: boolean; error?: string }>({});
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader><CardTitle className="font-display text-2xl">Reset password</CardTitle></CardHeader>
      <form action={(fd) => startTransition(async () => setMsg(await resetPasswordAction(fd)))}>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          {msg.error && <p className="text-sm text-destructive">{msg.error}</p>}
          {msg.ok && <p className="text-sm text-emerald-400">Check your inbox for a reset link.</p>}
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Sending..." : "Send reset link"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
```

- [ ] **Step 4: Commit**

Run:
```bash
git add app/auth/ app/\(auth\)/reset-password
git -c commit.gpgsign=false commit -m "feat(auth): callback handler + reset password flow

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase F — Authenticated home + projects card grid

### Task F1: `/home` page with project card grid

**Files:**
- Create: `app/home/page.tsx`, `app/home/layout.tsx`, `components/project-card.tsx`, `lib/queries/projects.ts`
- Test: `playwright/home.spec.ts`

- [ ] **Step 1: Write the failing E2E test**

Create `playwright/home.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("unauthenticated home redirects to sign-in", async ({ page }) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/sign-in/);
});
```

- [ ] **Step 2: Verify it fails**

Run: `npx playwright test playwright/home.spec.ts`
Expected: FAIL (no redirect yet).

- [ ] **Step 3: Create the home layout that enforces auth**

Create `app/home/layout.tsx`:
```tsx
import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/sign-in");
  return <div className="min-h-screen bg-background">{children}</div>;
}
```

- [ ] **Step 4: Create the projects query**

Create `lib/queries/projects.ts`:
```ts
import { createServerSupabase } from "@/lib/supabase/server";

export async function listMyProjects() {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { owned: [], shared: [] };

  const { data } = await sb
    .from("projects")
    .select("id, name, description, owner_id, center_lat, center_lon, default_zoom, visibility, archived, created_at, updated_at, project_members!inner(role)")
    .eq("archived", false)
    .order("updated_at", { ascending: false });

  const rows = data ?? [];
  return {
    owned: rows.filter((r) => r.owner_id === user.id),
    shared: rows.filter((r) => r.owner_id !== user.id),
  };
}
```

- [ ] **Step 5: Create the project card component**

Create `components/project-card.tsx`:
```tsx
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { MapPin, Users } from "lucide-react";

type Props = {
  id: string;
  name: string;
  description: string | null;
  visibility: "private" | "public_read";
  role: string;
};

export function ProjectCard({ id, name, description, visibility, role }: Props) {
  return (
    <Link href={`/p/${id}`}>
      <Card className="h-full transition hover:border-primary/50 hover:shadow-lg">
        <CardHeader className="pb-2">
          <h2 className="font-display text-lg font-bold leading-tight">{name}</h2>
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {description || "No description"}
          </p>
        </CardHeader>
        <CardContent className="flex items-center gap-3 pt-0 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {visibility === "public_read" ? "Public" : "Private"}</span>
          <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {role}</span>
        </CardContent>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 6: Create the home page**

Create `app/home/page.tsx`:
```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { listMyProjects } from "@/lib/queries/projects";
import { ProjectCard } from "@/components/project-card";
import { Plus } from "lucide-react";

export default async function HomePage() {
  const { owned, shared } = await listMyProjects();
  const empty = owned.length === 0 && shared.length === 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Your projects</h1>
          <p className="text-sm text-muted-foreground">Create or open a survey project.</p>
        </div>
        <Button asChild><Link href="/home/new"><Plus className="mr-1.5 h-4 w-4" /> New project</Link></Button>
      </header>

      {empty && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No projects yet.</p>
          <Button asChild className="mt-4"><Link href="/home/new">Create your first project</Link></Button>
        </div>
      )}

      {owned.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Owned by you</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {owned.map((p) => (
              <ProjectCard
                key={p.id}
                id={p.id}
                name={p.name}
                description={p.description}
                visibility={p.visibility as "private" | "public_read"}
                role={p.project_members[0].role}
              />
            ))}
          </div>
        </section>
      )}

      {shared.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Shared with you</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shared.map((p) => (
              <ProjectCard
                key={p.id}
                id={p.id}
                name={p.name}
                description={p.description}
                visibility={p.visibility as "private" | "public_read"}
                role={p.project_members[0].role}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Run the E2E test**

Run: `npx playwright test playwright/home.spec.ts`
Expected: PASS — unauthenticated visit redirects to `/sign-in`.

- [ ] **Step 8: Commit**

Run:
```bash
git add app/home components/project-card.tsx lib/queries/ playwright/home.spec.ts
git -c commit.gpgsign=false commit -m "feat(home): authenticated /home with project card grid

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase G — Create-project flow

### Task G1: `/home/new` create-project page

**Files:**
- Create: `app/home/new/page.tsx`, `app/home/new/actions.ts`, `lib/geocode.ts`
- Test: `lib/geocode.test.ts`

- [ ] **Step 1: Write the failing test for geocode**

Create `lib/geocode.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { geocodeAddress } from "./geocode";

const ok = (data: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);

beforeEach(() => { vi.restoreAllMocks(); });

describe("geocodeAddress", () => {
  it("returns first Nominatim result", async () => {
    vi.spyOn(global, "fetch").mockReturnValue(
      ok([{ lat: "29.6516", lon: "-82.3248", display_name: "Gainesville, FL" }]),
    );
    const r = await geocodeAddress("Gainesville FL");
    expect(r).toEqual({ lat: 29.6516, lon: -82.3248, displayName: "Gainesville, FL" });
  });

  it("returns null when no results", async () => {
    vi.spyOn(global, "fetch").mockReturnValue(ok([]));
    expect(await geocodeAddress("zzzzz")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- lib/geocode.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement geocode**

Create `lib/geocode.ts`:
```ts
type Result = { lat: number; lon: number; displayName: string };

export async function geocodeAddress(query: string): Promise<Result | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  const res = await fetch(url, { headers: { "User-Agent": "FieldSurvey/1.0" } });
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  if (rows.length === 0) return null;
  return { lat: parseFloat(rows[0].lat), lon: parseFloat(rows[0].lon), displayName: rows[0].display_name };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npm run test -- lib/geocode.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the createProject action**

Create `app/home/new/actions.ts`:
```ts
"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

const schema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(1000).optional(),
  centerLat: z.coerce.number().gte(-90).lte(90),
  centerLon: z.coerce.number().gte(-180).lte(180),
  defaultZoom: z.coerce.number().int().min(1).max(22).default(14),
});

export async function createProjectAction(formData: FormData) {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    centerLat: formData.get("centerLat"),
    centerLon: formData.get("centerLon"),
    defaultZoom: formData.get("defaultZoom") || 14,
  });
  if (!parsed.success) return { error: "Fill in name and a valid map location." };

  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data, error } = await sb
    .from("projects")
    .insert({
      owner_id: user.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      center_lat: parsed.data.centerLat,
      center_lon: parsed.data.centerLon,
      default_zoom: parsed.data.defaultZoom,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create project." };
  redirect(`/p/${data.id}`);
}
```

- [ ] **Step 6: Create the create-project page**

Create `app/home/new/page.tsx`:
```tsx
"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { createProjectAction } from "./actions";

export default function NewProjectPage() {
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lon: number; label: string } | null>(null);

  async function doGeocode() {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(search)}`);
    const j = await r.json();
    if (j?.lat) setCoords({ lat: j.lat, lon: j.lon, label: j.displayName });
    else setErr("Address not found. Try a more specific search.");
  }

  return (
    <main className="mx-auto max-w-lg p-8">
      <Card>
        <CardHeader><CardTitle className="font-display text-2xl">New project</CardTitle></CardHeader>
        <form
          action={(fd) => {
            if (coords) {
              fd.set("centerLat", String(coords.lat));
              fd.set("centerLon", String(coords.lon));
            }
            startTransition(async () => {
              const r = await createProjectAction(fd);
              if (r?.error) setErr(r.error);
            });
          }}
        >
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Project name</Label>
              <Input id="name" name="name" required maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description (optional)</Label>
              <Input id="description" name="description" maxLength={1000} />
            </div>
            <div className="space-y-1.5">
              <Label>Map center</Label>
              <div className="flex gap-2">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Gainesville, FL" />
                <Button type="button" variant="outline" onClick={doGeocode}>Find</Button>
              </div>
              {coords && (
                <p className="text-xs text-muted-foreground">
                  {coords.label} ({coords.lat.toFixed(4)}, {coords.lon.toFixed(4)})
                </p>
              )}
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={pending || !coords}>
              {pending ? "Creating..." : "Create project"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
```

- [ ] **Step 7: Create geocode API route**

Create `app/api/geocode/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { geocodeAddress } from "@/lib/geocode";

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get("q") || "";
  if (!q.trim()) return NextResponse.json({ error: "missing q" }, { status: 400 });
  const r = await geocodeAddress(q);
  return NextResponse.json(r ?? { error: "no match" }, { status: r ? 200 : 404 });
}
```

- [ ] **Step 8: Commit**

Run:
```bash
git add app/home/new app/api/geocode lib/geocode.ts lib/geocode.test.ts
git -c commit.gpgsign=false commit -m "feat(projects): create-project page + Nominatim geocoder

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase H — Project shell + device auto-routing

### Task H1: Device detection lib

**Files:**
- Create: `lib/device.ts`
- Test: `lib/device.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/device.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isMobileUserAgent, detectOS } from "./device";

describe("isMobileUserAgent", () => {
  it("matches iPhone", () => expect(isMobileUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0...)")).toBe(true));
  it("matches Android", () => expect(isMobileUserAgent("Mozilla/5.0 (Linux; Android 14...)")).toBe(true));
  it("does NOT match macOS Safari", () => expect(isMobileUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(false));
});

describe("detectOS", () => {
  it("ios", () => expect(detectOS("iPhone")).toBe("ios"));
  it("android", () => expect(detectOS("Android")).toBe("android"));
  it("macos", () => expect(detectOS("Macintosh")).toBe("macos"));
  it("windows", () => expect(detectOS("Windows NT 10.0")).toBe("windows"));
  it("other", () => expect(detectOS("CrOS x86_64")).toBe("other"));
});
```

- [ ] **Step 2: Verify fail**

Run: `npm run test -- lib/device.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `lib/device.ts`:
```ts
export type OS = "ios" | "android" | "macos" | "windows" | "other";

export function isMobileUserAgent(ua: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export function detectOS(ua: string): OS {
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh/.test(ua)) return "macos";
  if (/Windows/.test(ua)) return "windows";
  return "other";
}

export function detectClient(ua: string, viewportWidth: number, isTouch: boolean) {
  const mobileUA = isMobileUserAgent(ua);
  const narrow = viewportWidth < 768;
  const isMobile = mobileUA || (narrow && isTouch);
  return { isMobile, os: detectOS(ua) };
}
```

- [ ] **Step 4: Verify pass**

Run: `npm run test -- lib/device.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run:
```bash
git add lib/device.ts lib/device.test.ts
git -c commit.gpgsign=false commit -m "feat(device): user-agent detection helpers + tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task H2: Project shell with auto-redirect

**Files:**
- Create: `app/p/[projectId]/layout.tsx`, `app/p/[projectId]/page.tsx`, `app/p/[projectId]/map/page.tsx`, `app/p/[projectId]/field/page.tsx`, `components/project-sidebar.tsx`, `components/project-tabbar.tsx`, `lib/queries/project.ts`

- [ ] **Step 1: Create the project query**

Create `lib/queries/project.ts`:
```ts
import { createServerSupabase } from "@/lib/supabase/server";

export async function getProjectForUser(projectId: string) {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();

  const { data: project } = await sb
    .from("projects")
    .select("id, name, description, owner_id, center_lat, center_lon, default_zoom, visibility, archived")
    .eq("id", projectId)
    .single();

  if (!project) return null;

  let role: string | null = null;
  if (user) {
    const { data: m } = await sb
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    role = m?.role ?? null;
  }

  return { project, role };
}
```

- [ ] **Step 2: Create the sidebar (desktop)**

Create `components/project-sidebar.tsx`:
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, List, BarChart3, Inbox, MessageSquare, Users, Settings, Upload } from "lucide-react";

const items = [
  { href: "map", label: "Map", icon: Map },
  { href: "points", label: "Points", icon: List },
  { href: "responses", label: "Responses", icon: Inbox },
  { href: "analytics", label: "Analytics", icon: BarChart3 },
  { href: "chat", label: "Chat", icon: MessageSquare },
  { href: "members", label: "Members", icon: Users },
  { href: "settings", label: "Settings", icon: Settings },
  { href: "import", label: "Import", icon: Upload },
];

export function ProjectSidebar({ projectId }: { projectId: string }) {
  const path = usePathname();
  return (
    <aside className="hidden w-16 shrink-0 flex-col border-r bg-card md:flex">
      {items.map(({ href, label, icon: Icon }) => {
        const active = path?.includes(`/${href}`);
        return (
          <Link
            key={href}
            href={`/p/${projectId}/${href}`}
            className={`flex flex-col items-center gap-1 py-3 text-[10px] uppercase tracking-wider transition ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
            title={label}
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </Link>
        );
      })}
    </aside>
  );
}
```

- [ ] **Step 3: Create the tab-bar (mobile)**

Create `components/project-tabbar.tsx`:
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, Plus, MessageSquare, MoreHorizontal } from "lucide-react";

export function ProjectTabbar({ projectId }: { projectId: string }) {
  const path = usePathname();
  const items = [
    { href: `/p/${projectId}/field`, label: "Map", icon: Map },
    { href: `/p/${projectId}/field/add`, label: "Add", icon: Plus },
    { href: `/p/${projectId}/field/chat`, label: "Chat", icon: MessageSquare },
    { href: `/p/${projectId}/field/more`, label: "More", icon: MoreHorizontal },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex h-14 items-center border-t bg-card md:hidden">
      {items.map(({ href, label, icon: Icon }) => {
        const active = path === href;
        return (
          <Link key={href} href={href} className={`flex flex-1 flex-col items-center gap-0.5 text-[10px] ${active ? "text-primary" : "text-muted-foreground"}`}>
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Create the project layout**

Create `app/p/[projectId]/layout.tsx`:
```tsx
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getProjectForUser } from "@/lib/queries/project";
import { ProjectSidebar } from "@/components/project-sidebar";
import { ProjectTabbar } from "@/components/project-tabbar";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  const res = await getProjectForUser(projectId);
  if (!res) notFound();

  const { project, role } = res;
  const canView = role || project.visibility === "public_read";
  if (!canView) {
    if (!user) redirect(`/sign-in?next=/p/${projectId}`);
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <header className="flex h-14 items-center gap-3 border-b bg-card px-4 md:hidden">
        <h1 className="truncate font-display text-base font-bold">{project.name}</h1>
      </header>
      <ProjectSidebar projectId={projectId} />
      <main className="flex-1 pb-14 md:pb-0">{children}</main>
      <ProjectTabbar projectId={projectId} />
    </div>
  );
}
```

- [ ] **Step 5: Create the auto-redirect index page**

Create `app/p/[projectId]/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isMobileUserAgent } from "@/lib/device";

export default async function ProjectIndex({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const h = await headers();
  const ua = h.get("user-agent") || "";
  redirect(isMobileUserAgent(ua) ? `/p/${projectId}/field` : `/p/${projectId}/map`);
}
```

- [ ] **Step 6: Create stub map and field pages**

Create `app/p/[projectId]/map/page.tsx`:
```tsx
import { getProjectForUser } from "@/lib/queries/project";

export default async function ProjectMapPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const r = await getProjectForUser(projectId);
  return (
    <div className="p-6">
      <h1 className="font-display text-2xl font-bold">{r?.project.name}</h1>
      <p className="text-sm text-muted-foreground">Desktop map view — comes online in M2.</p>
    </div>
  );
}
```

Create `app/p/[projectId]/field/page.tsx`:
```tsx
export default function ProjectFieldPage() {
  return (
    <div className="p-6">
      <h1 className="font-display text-xl font-bold">Field view</h1>
      <p className="text-sm text-muted-foreground">Mobile field view — comes online in M2.</p>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

Run:
```bash
git add app/p components/project-sidebar.tsx components/project-tabbar.tsx lib/queries/project.ts
git -c commit.gpgsign=false commit -m "feat(project): project shell with device-aware auto-redirect

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase I — Members + invites

### Task I1: Members page (list + invite form)

**Files:**
- Create: `app/p/[projectId]/members/page.tsx`, `app/p/[projectId]/members/actions.ts`, `lib/email.ts`

- [ ] **Step 1: Create the email helper**

Create `lib/email.ts` — Gmail SMTP via nodemailer (ports the Keystone `_send_via_gmail_smtp` pattern to TypeScript):
```ts
import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;
  const user = (process.env.GMAIL_USER ?? "").trim();
  const pass = (process.env.GMAIL_APP_PASSWORD ?? "").trim().replace(/\s+/g, "");
  if (!user || !pass) {
    throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD not configured");
  }
  cachedTransporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // STARTTLS upgrade
    auth: { user, pass },
  });
  return cachedTransporter;
}

function fromHeader(): string {
  const name = (process.env.EMAIL_FROM_NAME ?? "FieldSurvey").trim();
  const user = (process.env.GMAIL_USER ?? "").trim();
  // Display name + dedicated Gmail address; Gmail rewrites the envelope
  // sender to GMAIL_USER for anti-spoofing. Same pattern as Keystone's
  // formataddr(("KeyStone Field", user)).
  return `"${name.replace(/"/g, '\\"')}" <${user}>`;
}

export type SendEmailArgs = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

export async function sendEmail(args: SendEmailArgs): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  try {
    const info = await getTransporter().sendMail({
      from: fromHeader(),
      to: Array.isArray(args.to) ? args.to.join(", ") : args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendInviteEmail(args: { to: string; projectName: string; inviterName: string; acceptUrl: string }) {
  const subject = `${args.inviterName} invited you to ${args.projectName}`;
  const text = [
    `Hello,`,
    ``,
    `${args.inviterName} invited you to the FieldSurvey project "${args.projectName}".`,
    ``,
    `Accept the invite: ${args.acceptUrl}`,
    ``,
    `This link expires in 14 days.`,
    ``,
    `— FieldSurvey`,
  ].join("\n");
  const html = `
    <p>Hello,</p>
    <p><strong>${args.inviterName}</strong> invited you to the FieldSurvey project <strong>${args.projectName}</strong>.</p>
    <p><a href="${args.acceptUrl}" style="display:inline-block;padding:10px 16px;background:#38bdf8;color:#0d1117;text-decoration:none;border-radius:6px;font-weight:600">Accept invite</a></p>
    <p style="color:#8b949e;font-size:13px">Or paste this URL into your browser: <code>${args.acceptUrl}</code></p>
    <p style="color:#8b949e;font-size:13px">This link expires in 14 days.</p>
  `;
  return sendEmail({ to: args.to, subject, text, html });
}
```

- [ ] **Step 2: Create the invite/revoke server actions**

Create `app/p/[projectId]/members/actions.ts`:
```ts
"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { sendInviteEmail } from "@/lib/email";

const invite = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "surveyor", "viewer"]),
});

export async function inviteMemberAction(projectId: string, formData: FormData) {
  const parsed = invite.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return { error: "Enter a valid email and role." };

  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data, error } = await sb
    .from("project_invites")
    .insert({
      project_id: projectId,
      email: parsed.data.email,
      role: parsed.data.role,
      invited_by: user.id,
    })
    .select("token")
    .single();
  if (error || !data) return { error: error?.message ?? "Failed." };

  const { data: project } = await sb.from("projects").select("name").eq("id", projectId).single();
  const { data: profile } = await sb.from("profiles").select("display_name,email").eq("id", user.id).single();
  const acceptUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${data.token}`;
  await sendInviteEmail({
    to: parsed.data.email,
    projectName: project?.name ?? "your project",
    inviterName: profile?.display_name || profile?.email || "Someone",
    acceptUrl,
  });

  revalidatePath(`/p/${projectId}/members`);
  return { ok: true };
}

export async function revokeInviteAction(projectId: string, inviteId: string) {
  const sb = await createServerSupabase();
  const { error } = await sb.from("project_invites").delete().eq("id", inviteId);
  if (error) return { error: error.message };
  revalidatePath(`/p/${projectId}/members`);
  return { ok: true };
}

export async function removeMemberAction(projectId: string, userId: string) {
  const sb = await createServerSupabase();
  const { error } = await sb.from("project_members").delete().eq("project_id", projectId).eq("user_id", userId);
  if (error) return { error: error.message };
  revalidatePath(`/p/${projectId}/members`);
  return { ok: true };
}
```

- [ ] **Step 3: Create the members page**

Create `app/p/[projectId]/members/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteMemberAction, revokeInviteAction } from "./actions";

export default async function MembersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) notFound();

  const { data: mems } = await sb
    .from("project_members")
    .select("user_id, role, joined_at, profiles(email, display_name, avatar_url)")
    .eq("project_id", projectId);

  const { data: invites } = await sb
    .from("project_invites")
    .select("id, email, role, expires_at, accepted_at")
    .eq("project_id", projectId)
    .is("accepted_at", null);

  const { data: me } = await sb
    .from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
  const canManage = me?.role === "owner" || me?.role === "admin";

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-2xl font-bold">Members</h1>
      {canManage && (
        <Card className="mt-6">
          <CardHeader><h2 className="font-display text-lg font-bold">Invite member</h2></CardHeader>
          <form action={async (fd) => { "use server"; await inviteMemberAction(projectId, fd); }}>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role">Role</Label>
                <select id="role" name="role" defaultValue="surveyor" className="h-9 rounded-md border bg-background px-3 text-sm">
                  <option value="admin">Admin</option>
                  <option value="surveyor">Surveyor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <Button type="submit">Send invite</Button>
            </CardContent>
          </form>
        </Card>
      )}

      <section className="mt-8 space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Members</h2>
        {(mems ?? []).map((m) => (
          <Card key={m.user_id}>
            <CardContent className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium">{m.profiles?.display_name || m.profiles?.email}</div>
                <div className="text-xs text-muted-foreground">{m.profiles?.email}</div>
              </div>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{m.role}</span>
            </CardContent>
          </Card>
        ))}
      </section>

      {canManage && (invites?.length ?? 0) > 0 && (
        <section className="mt-8 space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Pending invites</h2>
          {invites!.map((inv) => (
            <Card key={inv.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{inv.email}</div>
                  <div className="text-xs text-muted-foreground">{inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}</div>
                </div>
                <form action={async () => { "use server"; await revokeInviteAction(projectId, inv.id); }}>
                  <Button variant="outline" size="sm">Revoke</Button>
                </form>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Commit**

Run:
```bash
git add app/p/\[projectId\]/members lib/email.ts
git -c commit.gpgsign=false commit -m "feat(members): list + invite flow with Gmail SMTP email

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task I2: Accept-invite page

**Files:**
- Create: `app/invite/[token]/page.tsx`, `app/invite/[token]/actions.ts`

- [ ] **Step 1: Create the accept action**

Create `app/invite/[token]/actions.ts`:
```ts
"use server";
import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function acceptInviteAction(token: string) {
  const sb = await createServerSupabase();
  const { data, error } = await sb.rpc("accept_invite", { p_token: token });
  if (error) return { error: error.message };
  redirect(`/p/${data}`);
}
```

- [ ] **Step 2: Create the page**

Create `app/invite/[token]/page.tsx`:
```tsx
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { acceptInviteAction } from "./actions";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();

  const { data: invite } = await sb
    .from("project_invites")
    .select("email, role, accepted_at, expires_at, projects(name)")
    .eq("token", token)
    .maybeSingle();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle className="font-display text-2xl">Project invite</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!invite && <p className="text-destructive">This invite is invalid or no longer exists.</p>}
          {invite?.accepted_at && <p className="text-muted-foreground">This invite was already accepted.</p>}
          {invite && !invite.accepted_at && new Date(invite.expires_at) < new Date() && (
            <p className="text-destructive">This invite has expired.</p>
          )}
          {invite && !invite.accepted_at && new Date(invite.expires_at) >= new Date() && (
            <>
              <p>You were invited to <strong>{invite.projects?.name}</strong> as <strong>{invite.role}</strong>.</p>
              <p className="text-muted-foreground">The invite was sent to <code className="font-mono">{invite.email}</code>.</p>
              {!user && (
                <p className="text-amber-400">Please <Link href={`/sign-up?next=/invite/${token}`} className="underline">create an account</Link> with that email, or <Link href={`/sign-in?next=/invite/${token}`} className="underline">sign in</Link>.</p>
              )}
            </>
          )}
        </CardContent>
        {invite && !invite.accepted_at && user && (
          <CardFooter>
            <form action={async () => { "use server"; await acceptInviteAction(token); }} className="w-full">
              <Button type="submit" className="w-full">Accept invite</Button>
            </form>
          </CardFooter>
        )}
      </Card>
    </main>
  );
}
```

- [ ] **Step 3: Commit**

Run:
```bash
git add app/invite
git -c commit.gpgsign=false commit -m "feat(invites): accept-invite page with token validation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase J — Account page

### Task J1: Account profile + delete account

**Files:**
- Create: `app/account/page.tsx`, `app/account/actions.ts`, `app/account/layout.tsx`

- [ ] **Step 1: Create the layout (auth gate)**

Create `app/account/layout.tsx`:
```tsx
import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/sign-in");
  return <>{children}</>;
}
```

- [ ] **Step 2: Create the actions**

Create `app/account/actions.ts`:
```ts
"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function updateProfileAction(fd: FormData) {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const displayName = String(fd.get("displayName") || "").slice(0, 80);
  const { error } = await sb.from("profiles").update({ display_name: displayName }).eq("id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/account");
  return { ok: true };
}

export async function updatePasswordAction(fd: FormData) {
  const password = String(fd.get("password") || "");
  const schema = z.string().min(8).max(72);
  if (!schema.safeParse(password).success) return { error: "Password must be 8+ characters." };
  const sb = await createServerSupabase();
  const { error } = await sb.auth.updateUser({ password });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function deleteAccountAction() {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const admin = createAdminSupabase();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { error: error.message };
  await sb.auth.signOut();
  redirect("/");
}

export async function signOutAction() {
  const sb = await createServerSupabase();
  await sb.auth.signOut();
  redirect("/sign-in");
}
```

- [ ] **Step 3: Create the page**

Create `app/account/page.tsx`:
```tsx
import { createServerSupabase } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import {
  updateProfileAction,
  updatePasswordAction,
  deleteAccountAction,
  signOutAction,
} from "./actions";

export default async function AccountPage() {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  const { data: profile } = await sb.from("profiles").select("email,display_name").eq("id", user!.id).single();

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="font-display text-2xl font-bold">Account</h1>

      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <form action={updateProfileAction}>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={profile?.email ?? ""} disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Name</Label>
              <Input id="displayName" name="displayName" defaultValue={profile?.display_name ?? ""} maxLength={80} />
            </div>
          </CardContent>
          <CardFooter><Button type="submit">Save</Button></CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader><CardTitle>Password</CardTitle></CardHeader>
        <form action={updatePasswordAction}>
          <CardContent>
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input id="password" name="password" type="password" minLength={8} required />
            </div>
          </CardContent>
          <CardFooter><Button type="submit">Change password</Button></CardFooter>
        </form>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader><CardTitle className="text-destructive">Danger zone</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Deleting your account will remove your profile and all projects you own. Projects where you are a member will remain (your role is removed).</p>
        </CardContent>
        <CardFooter className="flex gap-2">
          <form action={signOutAction}><Button type="submit" variant="outline">Sign out</Button></form>
          <form action={deleteAccountAction}>
            <Button type="submit" variant="destructive">Delete account</Button>
          </form>
        </CardFooter>
      </Card>
    </main>
  );
}
```

- [ ] **Step 4: Commit**

Run:
```bash
git add app/account
git -c commit.gpgsign=false commit -m "feat(account): profile, password, delete-account, sign-out

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase K — Landing page

### Task K1: Replace placeholder `/` with proper landing + redirect when signed in

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Update `app/page.tsx`**

Replace contents with:
```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

export default async function LandingPage() {
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (user) redirect("/home");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <div className="max-w-xl space-y-6">
        <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">FieldSurvey</h1>
        <p className="text-base text-muted-foreground md:text-lg">
          Run spatial surveys with your team. Collect points in the field, see them on a live map, and ship the results.
        </p>
        <div className="flex justify-center gap-3">
          <Button asChild size="lg"><Link href="/sign-up">Get started</Link></Button>
          <Button asChild size="lg" variant="outline"><Link href="/sign-in">Sign in</Link></Button>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

Run:
```bash
git add app/page.tsx
git -c commit.gpgsign=false commit -m "feat(landing): minimal marketing landing page + signed-in redirect

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase L — CI + smoke E2E

### Task L1: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npx playwright test
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          GMAIL_USER: ${{ secrets.GMAIL_USER }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
          EMAIL_FROM_NAME: FieldSurvey
          NEXT_PUBLIC_APP_URL: http://localhost:3000
```

- [ ] **Step 2: Commit**

Run:
```bash
git add .github
git -c commit.gpgsign=false commit -m "ci: typecheck, lint, test, build, E2E on push and PR

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task L2: Smoke E2E covering the full M1 happy path

**Files:**
- Create: `playwright/m1-happy-path.spec.ts`

- [ ] **Step 1: Write the smoke test**

Create `playwright/m1-happy-path.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "needs Supabase env");

test("landing redirects unauth users to home only when signed in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /get started/i })).toBeVisible();
});

test("sign-up page is reachable", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
});

test("sign-in page is reachable", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("home redirects unauth to sign-in", async ({ page }) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/sign-in/);
});
```

- [ ] **Step 2: Run the suite**

Run: `npx playwright test`
Expected: all green.

- [ ] **Step 3: Commit**

Run:
```bash
git add playwright/m1-happy-path.spec.ts
git -c commit.gpgsign=false commit -m "test(e2e): M1 smoke happy-path

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task L3: README + DEPLOY + SETUP docs

**Files:**
- Create: `README.md`, `DEPLOY.md`, `SETUP.md`

- [ ] **Step 1: Create README.md**

Create `README.md`:
```markdown
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
```

- [ ] **Step 2: Create SETUP.md**

Create `SETUP.md`:
```markdown
# FieldSurvey Setup

These steps provision a fresh Supabase + Vercel + Gmail App Password for FieldSurvey. They are intentionally separate from the original KeyStone instances.

## 1. Supabase

1. https://supabase.com/dashboard → New project → name `fieldsurvey-prod`
2. Region: closest to your users
3. Save the DB password in a password manager
4. Project Settings → API → copy `URL`, `anon` key, `service_role` key
5. SQL Editor → paste `supabase/migrations/001_init.sql` → Run
6. Storage → create bucket `avatars` (public) and `point-photos` (private)
7. Auth → Providers → Email: enable Email + Magic links

## 2. Vercel

1. `npm i -g vercel`
2. `vercel link` (Create new project → name `fieldsurvey`)
3. `vercel env add` for each: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `EMAIL_FROM_NAME`, `NEXT_PUBLIC_APP_URL`

## 3. Gmail App Password (for outbound email)

Same pattern as Keystone (`api/_email_logic.py::_send_via_gmail_smtp`):

1. Pick or create a dedicated Gmail account (e.g. `fieldsurvey-mail@gmail.com`) — recipients will see all outbound FieldSurvey mail as coming from this address.
2. Enable **2-Step Verification** at https://myaccount.google.com/security
3. Generate an App Password at https://myaccount.google.com/apppasswords (app name: "FieldSurvey"). Copy the 16-character string.
4. In `.env.local` and Vercel: `GMAIL_USER=<the gmail address>`, `GMAIL_APP_PASSWORD=<the 16-char password>`, `EMAIL_FROM_NAME=FieldSurvey`.

## 4. Local

```bash
cp .env.example .env.local
# paste the values
npm install
npm run dev
```
```

- [ ] **Step 3: Create DEPLOY.md**

Create `DEPLOY.md`:
```markdown
# Deploy

## Preview deploy (every push to non-main)

Push the branch. Vercel auto-builds a preview URL.

## Production deploy

```bash
vercel --prod
```

## Database migrations

For now, paste new files in `supabase/migrations/` into the Supabase SQL editor manually. Automated CLI-driven migrations land in M2.
```

- [ ] **Step 4: Commit**

Run:
```bash
git add README.md SETUP.md DEPLOY.md
git -c commit.gpgsign=false commit -m "docs: README, SETUP, DEPLOY for FieldSurvey

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## M1 acceptance check

Before declaring M1 done, run through these by hand against the deployed preview:

- [ ] Visit `/` — see landing page (signed out).
- [ ] Click *Get started* → create an account with a real email.
- [ ] Confirm email → land on `/home` empty state.
- [ ] Click *Create your first project* → name + geocode address → land on `/p/[id]/map` (desktop) or `/p/[id]/field` (mobile).
- [ ] Members page → invite a second email → receive the invite email (sent via Gmail SMTP).
- [ ] Open the invite link in an incognito window → create the second account → land in the project.
- [ ] On the laptop you see both members in the Members page.
- [ ] Visit `/p/[id]` on a phone — auto-redirects to `/field`.
- [ ] Visit `/p/[id]` on desktop — auto-redirects to `/map`.
- [ ] Account page → change display name → see it persist.
- [ ] Sign out → land back on `/`.

---

**End of M1 plan.** M2 plan gets written after M1 ships.
