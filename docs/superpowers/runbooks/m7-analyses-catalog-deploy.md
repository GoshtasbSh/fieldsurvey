# M7 Analyses Catalog (wave-1) — deploy runbook

This runbook is the operational companion to `sidecar/README.md`. Use it
when promoting the `feat/m7-wave1-analyses-catalog` branch to production
or when rolling back after an incident.

## Migration apply order

Apply in this order; later migrations assume earlier ones are present.

1. **`015_analyses_catalog.sql`** — creates `analyses_saved_views`,
   `analyses_saved_view_cards`, the per-project default-view trigger,
   and the seed function.
2. **`016_analyses_rpcs.sql`** — adds the postgres-strategy RPCs called
   by the dispatcher at `app/api/projects/[projectId]/analyses/[cardId]`
   (response-rate panel, hour histogram, dow heatmap, top-K, etc.).
3. **`017_sidecar_cache_keys.sql`** — widens the `dashboard_cache` and
   `analysis_versions` CHECK constraints to admit the 4 new sidecar
   keys (`A21_finish`, `A25_velocity`, `A11_kde`, `A8_gi_star`). The
   sidecar will throw a constraint-violation on its first write without
   this migration.

```bash
supabase db push                          # all three at once
# or apply individually for incremental rollout
supabase db push --include 015,016,017
```

## Saved views: seeded automatically

The `tg_analyses_saved_views_seed_default` trigger on `projects` fires
on insert and seeds a `Default` saved view per project, populated from
`ANALYSES_REGISTRY.filter(c => c.defaultPack)` (>=10 cards). No
manual seeding required after migrations land — but for projects that
existed before `015`, run the backfill:

```sql
select public.seed_default_saved_view(id) from public.projects
 where id not in (
   select project_id from public.analyses_saved_views where name = 'Default'
 );
```

## Vercel deploy

See `sidecar/README.md` § "Production deploy (T35)" for env vars,
`vercel --prod`, and per-route smoke. Expected build time ~5 minutes
cold, ~2 minutes warm.

## Smoke for postgres-strategy cards

After deploy, hit one or two postgres-strategy cards to confirm the
dispatcher round-trip works without the sidecar:

```bash
DEPLOY="https://<deployment>"
PROJECT_ID="<a real project uuid you own>"
COOKIE="<your auth cookie or use signed-in browser>"

# A39 freshness chip — fastest sanity check
curl -sS -H "cookie: $COOKIE" \
  "$DEPLOY/api/projects/$PROJECT_ID/analyses/A39_freshness"

# A16 AAPOR response rates panel
curl -sS -H "cookie: $COOKIE" \
  "$DEPLOY/api/projects/$PROJECT_ID/analyses/A16_rr"

# A23 hour-of-day histogram
curl -sS -H "cookie: $COOKIE" \
  "$DEPLOY/api/projects/$PROJECT_ID/analyses/A23_hour_local"

# A51 Top-K underrepresented blocks
curl -sS -H "cookie: $COOKIE" \
  "$DEPLOY/api/projects/$PROJECT_ID/analyses/A51_topk"
```

All four should return `{ ok: true, data: { ... } }` within ~250 ms p95.

## Sidecar smoke

See `sidecar/README.md` § "Per-route POST smoke" for the 4 sidecar
endpoints. After each POST, verify the corresponding `dashboard_cache`
row was written (see § "Verify cache writes landed").

## Rollback

Mirrors `sidecar/README.md` § "Rollback procedure":

1. `vercel rollback <prev-prod-id>` to recover the previous build.
2. Set `SIDECAR_URL=""` and redeploy to fall back to the
   postgres-strategy + placeholder branches of the dispatcher.
3. Delete the offending `dashboard_cache` row if a single project's
   payload triggered the regression.
4. File an incident ticket with deployment id, route, p95 timing
   (via `mcp__plugin_vercel-plugin_vercel__get_runtime_logs`), and the
   offending project.

## Migration rollback (if 017 needs revert)

```sql
alter table public.dashboard_cache
  drop constraint if exists dashboard_cache_data_type_check;
alter table public.dashboard_cache
  add constraint dashboard_cache_data_type_check
  check (data_type in (
    'pulse_blob','analyze_blob','match_status_blob',
    'points_geojson','responses_geojson','canvass_blob'
  ));

alter table public.analysis_versions
  drop constraint if exists analysis_versions_data_type_check;
alter table public.analysis_versions
  add constraint analysis_versions_data_type_check
  check (data_type in (
    'pulse_blob','analyze_blob','match_status_blob',
    'points_geojson','responses_geojson','canvass_blob'
  ));

-- Delete any sidecar-key rows that snuck in before revert
delete from public.dashboard_cache
 where data_type in ('A21_finish','A25_velocity','A11_kde','A8_gi_star');
delete from public.analysis_versions
 where data_type in ('A21_finish','A25_velocity','A11_kde','A8_gi_star');
```
