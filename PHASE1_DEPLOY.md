# Phase 1 — Team membership + admin role + invite-code + guest surveyors

This phase closes the four deploy-blockers we agreed on:

- **A2** `/api/chat` was anonymous → now requires team membership.
- **A4** Open signup + permissive RLS meant any new sign-up could wipe the
  database → now persistent signup *and* one-day guest sessions are gated
  by the daily-rotating invite code; `community_contacts` / `iaq_surveys`
  / `report_config` are admin-only writes.
- The `/admin` page now refuses non-admins, exposes team management,
  today's invite code, and the **Guest Sessions** roster (with revoke).
- One-day surveyors no longer need an account at all — they enter their
  name + today's code and become a guest with a 12h sliding-window
  session. Pins they collect are forever attributed to the name they
  entered, and admins can audit / revoke any session.

It also ships these supporting changes:
- Per-respondent PII columns (`RecipientEmail`, `IPAddress`, etc.) are now
  stripped on `/api/upload/results`.
- `/api/upload/{iaq,survey,results}` and `/api/versions/restore` are now
  admin-only (was: any authenticated user — closing a service-role
  bypass that existed because uploads use the service-role key to write).
- The dashboard's "Run Daily Refresh Now" button now sends a Bearer JWT
  and `daily-refresh` accepts an admin user JWT as an alternative to the
  cron secret. This used to 401 silently in production.
- `keystone_field_api/main.py` was kept (already `.vercelignore`d) but
  the module top now `raise RuntimeError(...)` so accidental imports fail
  loudly. **You should `git rm -rf keystone_field_api/` when convenient**
  — it's never deployed; the runtime guard is belt-and-suspenders.

---

## Files added or changed

```
supabase/migrations/09_team_membership.sql         (new)
supabase/migrations/10_tighten_writes.sql          (new)
supabase/migrations/11_guest_sessions.sql          (new — guest sessions + alter field_survey_points)

api/_lib.py                                        (helpers: require_team_member, require_admin, authed_supabase, _bearer_jwt)
api/team/claim.py                                  (new — persistent member claim)
api/team/today-code.py                             (new)
api/team/promote.py                                (new)
api/team/demote.py                                 (new)
api/team/list.py                                   (new)
api/team/guest-history.py                          (new — admin audit of guest sessions)
api/team/revoke-guest.py                           (new — admin revoke a guest session)
api/guest/_helpers.py                              (new — shared session-validation utils)
api/guest/claim.py                                 (new — guest claims today's code with name)
api/guest/add-point.py                             (new — guest inserts a single field point)
api/guest/my-points.py                             (new — guest reads back the day's pins)
api/guest/heartbeat.py                             (new — keep-alive sliding window)
api/chat.py                                        (require_team_member; sanitised upstream error)
api/upload/iaq.py                                  (require_admin)
api/upload/survey.py                               (require_admin)
api/upload/results.py                              (require_admin + PII_COLS strip)
api/versions/restore.py                            (require_admin)
api/daily-refresh.py                               (admin-JWT path + constant-time secret compare)

keystone_field_web/login.html                      (Sign In | Create Account | Guest tabs)
keystone_field_web/admin.html                      (role gate + team UI + today-code button + Guest Sessions panel)
keystone_field_web/index.html                      (guest-mode branch — no Supabase auth, proxy endpoints)
keystone_field_api/main.py                         (DEAD-CODE banner + RuntimeError)
static/js/dashboard.js                             (runDailyRefresh sends Bearer JWT; honest insert-failure toast)
```

---

## Bootstrap order — read this before applying

The migrations need to be applied in order, with one manual checkpoint
in between. **If you apply 10 before your user is in `team_members` with
role='admin', you will lose the ability to upload data** (you'd have
to fix it via the Supabase SQL editor, which is an annoyance not a
disaster — but easier to avoid).

### Step 1 — make sure your account exists

You must already have a Supabase user in `auth.users` for
`YOUR_ADMIN_EMAIL@example.com`. If you've ever signed in to the dashboard
or the field app before, you're set — skip to Step 2.

If not, sign up at https://your-deploy.vercel.app/login (using whatever
your current Vercel URL is). The current login page accepts open signup
without an invite code, so this works *before* the migrations land.

### Step 2 — apply migration 09

In Supabase Dashboard → SQL Editor → New query, paste the contents of:

```
supabase/migrations/09_team_membership.sql
```

and click **Run**. This creates `team_members`, `invite_codes`, and the
`is_admin / claim_membership / get_or_create_today_code / promote_member /
demote_member / list_team / my_team_role` RPCs. There is no auto-seeded
admin — promote your bootstrap admin manually with the snippet at the
bottom of the migration file (substituting your email).

Verify it worked:

```sql
SELECT tm.role, u.email
  FROM team_members tm
  JOIN auth.users u ON u.id = tm.id
 WHERE u.email = 'YOUR_ADMIN_EMAIL@example.com';
```

You should see one row with `role = admin`.

> **If this returns 0 rows**, your `auth.users` row for that email
> doesn't exist yet. Sign up first at `/login`, then re-run only the
> bottom `INSERT … ON CONFLICT … UPDATE` block of `09_team_membership.sql`.

### Step 3 — apply migration 10

Same SQL Editor, paste the contents of:

```
supabase/migrations/10_tighten_writes.sql
```

and click **Run**. This drops the permissive policies on
`community_contacts`, `iaq_surveys`, `report_config`, and `field_survey_points`
and replaces them with team-member-reads + admin-writes.

After this, only your account can run uploads and only team members
can read field data.

### Step 3b — apply migration 11 (guest sessions)

Paste the contents of:

```
supabase/migrations/11_guest_sessions.sql
```

and click **Run**. This adds the `field_guest_sessions` table, the
`guest_session_id` foreign key on `field_survey_points`, and the
`list_guest_sessions` / `revoke_guest_session` RPCs.

This migration is independent of 10 — applying it doesn't change
behavior for existing persistent users. Order doesn't matter between
10 and 11; pick the order that's easiest. (We use 11 last just to keep
the file numbers monotonic.)

### Step 4 — deploy the code

```bash
git add api/ keystone_field_web/ static/ supabase/ PHASE1_DEPLOY.md
git commit -m "phase 1: team membership + invite code + admin role"
git push
```

Vercel will pick it up and deploy on the next push. Confirm the deploy
succeeds in the Vercel dashboard.

### Step 5 — set CRON_SECRET (if not already)

Vercel project → Settings → Environment Variables. Add:

- `CRON_SECRET` — any long random string. Used by the `0 6 * * *` cron
  in `vercel.json` to authenticate the scheduled `daily-refresh`. The new
  admin-JWT path is independent of this — but the cron itself still
  needs it.

---

## Manual test plan (run after Step 4)

### Auth flow

1. **Sign in as you (already-promoted admin):** Go to `/login`. Sign in.
   You should land on `/dashboard` (or `/field/` on mobile) directly —
   the `my_team_role` RPC returns `role: 'admin'` so the claim screen
   is skipped.

2. **`/admin` access:** Go to `/admin`. The page should render with the
   new "Team & Invite Code" section. The team list should show your
   email with `ADMIN` tag and `(you)` next to it. There should be no
   Promote/Demote buttons next to your row.

3. **Generate today's code:** Click **Get today's code**. A 6-character
   code should appear. Note it down.

4. **Sign out + create a new test account:** Sign out. On `/login`, click
   Create Account, register a fake address (e.g. `test+keystone@example.com`).
   You should be taken to the **claim-code screen** — not the dashboard.

5. **Claim with the code:** Enter today's code. Should activate and
   redirect into the dashboard. The new account is a member, not an admin.

6. **Member can read but not write:** While signed in as the test user:
   - The dashboard should load with all data.
   - Going to `/admin` should show the "Admin role required" screen.
   - In Supabase Studio, the test user attempting an INSERT into
     `community_contacts` via PostgREST should get a 403 / RLS error.

7. **Promote the test user:** Sign back in as you, go to `/admin`,
   click **Promote → admin** next to the test user. Sign back in as
   the test user — `/admin` now loads.

8. **Demote test user:** As you (or as the test admin), demote the
   test user back to member. Last-admin protection: trying to demote
   yourself when you're the only admin should refuse.

9. **Wrong code:** Sign out, sign up with another fake email, enter a
   bogus code → should see "Invalid invite code".

10. **Run Daily Refresh Now:** As admin on `/dashboard`, click the
    "Run Daily Refresh Now" button. Should succeed (was 401-failing
    before).

11. **Chat:** Anonymous `curl -X POST https://your-deploy.vercel.app/api/chat`
    should return 401 now. Signed-in dashboard chat should still work.

### Guest surveyor flow

12. **Generate today's code as admin** at `/admin` if you haven't already.

13. **Open `/login` in a private window**, click the **Guest** tab, enter
    a name like "Test Surveyor" and today's code, click **Start surveying**.
    Should redirect to `/field/` with the guest banner showing.

14. **Drop a pin:** the FAB → status → Save flow should insert via
    `/api/guest/add-point`. Pin appears on the map immediately.

15. **Try to edit a pin:** Tap a pin → Edit. You should see a toast
    "Guests can only add new points (no editing)". Same for Delete.

16. **Try `/admin` as a guest:** `https://your-deploy/admin` should
    redirect (or render the access-denied screen) — guests have no
    Supabase session, so the admin page bounces them to `/login`.

17. **Admin sees the guest:** Sign back in as admin, go to `/admin`,
    Guest Sessions panel should show "Test Surveyor" with the pin count.

18. **Revoke the guest:** Click **Revoke** on the test session. Open
    the guest's tab again and try to add another pin → should toast
    "Your guest session has ended" and bounce to `/login`.

19. **Wrong code:** On the Guest tab, enter a bogus code → "Invalid or
    expired invite code. Ask an admin."

20. **Code rotates at UTC midnight:** At 00:00 UTC, the previous day's
    code stops working for *new* claims. Already-active guest sessions
    keep working until their 12h sliding window closes.

### Cleanup test users + guest sessions

```sql
-- Persistent test accounts:
DELETE FROM team_members
 WHERE id IN (SELECT id FROM auth.users WHERE email LIKE 'test+%@example.com');
DELETE FROM auth.users WHERE email LIKE 'test+%@example.com';

-- Guest sessions (their pins remain in field_survey_points with the
-- name they entered; the session row itself can be deleted safely
-- because guest_session_id has ON DELETE SET NULL):
DELETE FROM field_guest_sessions WHERE name LIKE 'Test%' OR name LIKE 'test%';
```

---

## Known limitations that Phase 1.5 will address

1. **Anonymous data scraping is still possible** for the API endpoints
   the dashboard reads (`/api/parcels`, `/api/community-contacts`,
   `/api/iaq-points`, `/api/iaq-analysis`, `/api/survey-points`,
   `/api/analysis`, `/api/analysis-meta`, `/api/versions`, `/api/config`).
   Phase 1.5 will add `require_team_member` to all of these and update
   `dashboard.js` + `keystone_field_web/index.html` to send the bearer
   JWT on every fetch.

2. **`field_survey_points` direct inserts** from the field-app rely on
   the new RLS policy added in `10_tighten_writes.sql` which requires
   the surveyor to be a `team_members` row. If you have existing
   surveyors that haven't claimed an invite code yet, they will get
   "RLS policy violation" on insert until they go through the claim flow.
   Tell them to sign in once at `/login` to get prompted for the code.

3. The XSS surfaces (field-point popup, streets table, upload-error toast)
   are still present — Phase 2.

4. The mobile field-app's service worker, offline-queue, and toast bugs
   are still present — Phase 4.

5. Cedar_Key dashboard fixes — Phase 5.

---

## Roll-back plan

If something goes wrong after applying migration 10, you can roll back
the RLS by running this SQL:

```sql
-- Revert to the pre-Phase-1 permissive policies
DROP POLICY IF EXISTS "Team members read community_contacts"     ON community_contacts;
DROP POLICY IF EXISTS "Admins write community_contacts (insert)" ON community_contacts;
DROP POLICY IF EXISTS "Admins write community_contacts (update)" ON community_contacts;
DROP POLICY IF EXISTS "Admins write community_contacts (delete)" ON community_contacts;

CREATE POLICY "Authenticated users can read community contacts"
  ON community_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert community contacts"
  ON community_contacts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update community contacts"
  ON community_contacts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete community contacts"
  ON community_contacts FOR DELETE TO authenticated USING (true);

-- Repeat the same shape for iaq_surveys, report_config, field_survey_points
-- (see 01_keystone_field.sql for the originals).
```

Don't drop `team_members` / `invite_codes` — leave the new tables; they
do nothing if no policies reference them.

---

## What to tell new surveyors / admins

The same daily code activates either path. **There are three onboarding flows:**

### Onboarding a new admin (e.g. another PI or staff researcher)

1. They sign up at `/login` (or sign in if they already have an account).
2. After signing in, they hit the claim-code screen.
3. You message them today's invite code.
4. They paste it, activate as a member.
5. You go to `/admin`, find them, click **Promote → admin**. Done.

### Onboarding a long-term member (a lab member who's not yet ready for admin)

1. They sign up.
2. They hit the claim-code screen.
3. You (or any admin) generates today's code on `/admin` and shares it.
4. They paste, activate as member. They can read all data and drop pins
   from a real account. They can't run uploads or wipe tables.

### Onboarding a one-day surveyor — the new path

1. **No signup.** They go to `/login` → click the **Guest** tab.
2. Enter their name (whatever shows up on the map and in the daily report).
3. Enter today's invite code (you share it verbally / over text).
4. Click **Start surveying** → land directly in the field app with a
   guest banner. They can drop pins for the rest of the day.
5. Their session auto-expires after 12 hours of idle (sliding window —
   each save renews it). Closing the tab also ends the session.
6. Pins they collected stay in the database forever, attributed to the
   name they entered. You can review the audit trail (IP-hash, UA,
   session timestamps, count) under **Guest Sessions** on `/admin`.

The code rotates daily (UTC). If you generate the code Monday morning
and a guest signs in Tuesday morning, they need *Tuesday's* code, not
Monday's. Generate a fresh code at the start of each survey day.

> **Note on names.** Guest names are unverified strings. If accuracy
> matters (e.g. for daily-report attribution), tell each surveyor what
> name to enter and confirm before they start. The Guest Sessions
> panel shows IP-hash + user-agent for forensic correlation if a name
> later turns out to be wrong.
