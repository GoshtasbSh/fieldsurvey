# Phase 3 — Pre-Deploy Audit

**Branch:** main · **Last commit:** `3dfa5a6` · **Audit date:** 2026-05-04

This document is the audit report + manual test plan you run before flipping
the production switch on `keystone-project-survey-blue.vercel.app`.

---

## Access matrix (the source of truth)

| Action | Anon URL | Guest | Member | Admin |
|---|---|---|---|---|
| Open desktop dashboard, see map / charts / aggregate Survey Results | ✅ | ✅* | ✅ | ✅ |
| Per-respondent Qualtric answers in popup `Survey Answers` tab | ❌ | ❌ | ✅ | ✅ |
| `Update Data` button | hidden | hidden | hidden | ✅ |
| `History → Run Daily Refresh` button | hidden | hidden | hidden | ✅ |
| Restore version (inside History modal) | hidden | hidden | hidden | ✅ |
| `Team` button | hidden | hidden | ✅ (read-only) | ✅ (full) |
| AI Chat panel | hidden | hidden | ✅ | ✅ |
| Mobile field web `/keystone_field_web` | redirects to /login | ✅ | ✅ | ✅ |
| Add / edit / delete pin · chat · team · export | n/a | ✅ | ✅ | ✅ |

\* Guests on desktop are redirected to the field app — they have no place on `/static`.

---

## Round 1 fixes (commit `3dfa5a6`)

| Severity | Title | File:line |
|---|---|---|
| 🔴 | AI chatbot broken — sendChatMessage missing Bearer JWT | dashboard.js:4433 |
| 🟡 | `btn-import` visible to anon + non-admin | dashboard.js applyRoleGatedUI |
| 🟡 | `btn-daily-refresh` visible to anon + non-admin | dashboard.js applyRoleGatedUI |
| 🟡 | Restore version button visible to non-admin | dashboard.js openHistoryModal |
| 🟡 | `chat-btn` visible to anon + non-team-member | dashboard.js applyRoleGatedUI |
| 🟡 | `/api/chat` no body-size cap (DoS) | api/chat.py:307 |

## Verified clean (no fix needed)

- All admin RPCs (`promote_member`, `demote_member`, `revoke_guest_session`,
  `get_or_create_today_code`, `promote_by_email`) check `is_admin(auth.uid())`
  internally. ✓
- `list_team` requires team membership via `EXISTS` clause. ✓
- `list_guest_sessions` admin-gated via WHERE clause. ✓
- `/api/iaq-points` strips per-respondent fields by default; `?full=1` requires
  team_member. ✓
- Dashboard `fetchIaqPoints()` correctly tries `?full=1` with Bearer JWT first,
  falls back to public stripped endpoint. ✓
- All mutating endpoints (`/api/upload`, `/api/versions` POST, `/api/daily-refresh`)
  call `require_admin`. ✓
- Service-role endpoints (`/api/field-points`, `/api/guest`) only return the
  enumerated fields — no PII leakage. ✓
- IAQ snapshot restore is complete: payload bundles `geojson` + `analysis` +
  `street_stats` + `validation` so a single upsert is sufficient. ✓
- Field-app offline queue uses `_qKey()` scoped to user/guest session — no
  cross-user leakage. ✓
- All XSS surfaces hardened in commit `38fa5ba`. ✓

## Open items (deferred — not deploy-blockers)

| # | Severity | Title | Why deferred |
|---|---|---|---|
| 9 | 🟢 | `_hash_ip` salt fallback chains to SUPABASE_SERVICE_ROLE_KEY | Subtle, not exploitable. Fix when KEYSTONE_IP_HASH_SALT is set in prod. |
| 10 | 🟢 | `/api/guest` claim has no rate limiting | 6-char code = ~2 B combos; bot brute-force impractical without distributed infra. Add when we have a backing store (e.g. Supabase counter table). |
| 11 | 🟢 | CSP meta tag not added | Needs careful tile-server allowlist test in preview. |

---

# Two-phone real-time smoke test

**Goal:** confirm the full guest+admin loop works end-to-end with realtime
sync between two phones and a desktop browser tab.

**Setup:** Phone A (admin), Phone B (guest), Desktop tab (admin OR anon).

## Pre-flight

- [ ] Phone A signed in at `/login` as admin (`georgeshahriari@gmail.com`).
- [ ] Phone A on `/admin` → click **Get today's code** → note 6-char code.
- [ ] Desktop tab open on `/static` → bottom analysis panel visible.
- [ ] Phone B has cleared its sessionStorage (private window OK).

## Test 1 — Guest claim + add point

- [ ] Phone B → `/login` → Guest tab → enter name `Field Tester` + today's code → **Start surveying**.
- [ ] Lands in `/keystone_field_web/`. Map renders. Sidebar legend numbers match desktop.
- [ ] Phone B → tap a house → FAB → status `No Answer` → Save.
- [ ] **Desktop within 30 s**: bottom panel `Total Addresses` increments by 1; legend `No Answer` increments by 1.
- [ ] **Phone A within 30 s**: same numbers update.

## Test 2 — XSS proof (Phase 2)

- [ ] Phone B → tap an empty area → FAB → status `Inaccessible` → Notes:
      `<img src=x onerror=alert('PWNED')>` → Save.
- [ ] Phone B → tap that pin → notes line shows literal text, no alert.
- [ ] **Desktop**: click same pin → notes line shows literal text, no alert.
- [ ] **Phone A**: click same pin → notes line shows literal text, no alert.

## Test 3 — Edit / delete (own pin only)

- [ ] Phone B → tap own pin → **Edit** → change status → Save → updates everywhere.
- [ ] Phone B → tap a pin Phone A created → no Edit/Delete buttons visible.
- [ ] Phone B → tap own pin → **Delete** → confirm → pin disappears on B,
      desktop, and Phone A within 30 s.

## Test 4 — Offline queue

- [ ] Phone B → airplane mode ON.
- [ ] Phone B → drop 3 pins quickly. Each shows toast `... — queued`. Sidebar badge shows 3.
- [ ] Phone B → airplane mode OFF.
- [ ] Within 10 s: badge clears, all 3 pins appear on desktop with `is_offline: true`.

## Test 5 — Chat

- [ ] Phone B → Team tab → Chats subtab → send message `Hello from guest`.
- [ ] **Phone A within 30 s**: message appears with display name `Field Tester`.
- [ ] **Phone A**: reply → appears on Phone B within 30 s.
- [ ] **Desktop (admin)**: AI Chat button (bottom-right) visible → click → ask
      `Which street has the worst risk?` → expect a real LLM response.
- [ ] **Desktop (anon — open private window)**: AI Chat button NOT visible.
      Update Data, History, Team buttons NOT visible.

## Test 6 — Admin promote / revoke

- [ ] Phone A → `/admin` → Guest Sessions panel → see `Field Tester` listed
      with point count = number from Test 1+3+4.
- [ ] Phone A → click **Revoke** on Field Tester.
- [ ] Phone B → try to add another pin → toast: session ended, redirected to /login.
- [ ] Phone A → `/static` → Team modal → enter Phone B's email (if they have an account)
      → **Make admin** → Phone B reload → /admin now opens.

## Test 7 — Daily refresh + parcel preserve

- [ ] On a previously analyzed dataset (Parcels tab populated):
- [ ] Phone A → Desktop → History → **Run Daily Refresh Now**.
- [ ] Confirm: alert shows N new field visits merged. Parcels tab still
      populated. Total contacts incremented by ~N (allow ±1 due to dedup).

## Test 8 — Per-respondent answer gating

- [ ] **Anon** (private window, no sign-in) → Desktop → click a Completed pin
      that has a Qualtric match → tabs `Survey Contact` and `Parcel Data`
      visible, NO `Survey Answers` tab.
- [ ] **Member or Admin** → same pin → `Survey Answers` tab visible with all
      per-question answers.

## Test 9 — Upload (admin) regression

- [ ] Phone A → Desktop → Update Data → upload a community-contact CSV.
- [ ] Confirm: Step 1 marked done, IAQ step unlocks, map auto-shows pins.
- [ ] Upload Qualtric IAQ CSV → Step 2 done. Toast: `N community contacts
      automatically marked Completed`.
- [ ] Click an upgraded pin → 3-tab popup with all data.

## Test 10 — Anon read-only sanity

- [ ] Open desktop in private window — no sign-in.
- [ ] Map loads. Layers / charts / Survey Results aggregate all render.
- [ ] No `Update Data`, no `History → Run Daily Refresh`, no `Team`, no AI Chat button.
- [ ] All data fetches return 200 (not 401). Field points update every 30 s
      via the polling fallback.

---

# Pre-deploy gate

- [ ] `CRON_SECRET` set in Vercel project settings.
- [ ] `python scripts/verify_parity.py` passes.
- [ ] All 10 tests above pass.
- [ ] Vercel preview deploy → tail `vercel logs <deployment>` for 5 min,
      no `UNCAUGHT` lines.
- [ ] `git status` clean, `git log` shows the audit commits.

When all checked, promote preview to production.
