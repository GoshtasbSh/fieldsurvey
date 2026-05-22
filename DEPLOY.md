# Deploy

## Preview deploy (every push to non-main)

Push the branch. Vercel auto-builds a preview URL.

## Production deploy

```bash
vercel --prod
```

## Database migrations

After adding a new file in `supabase/migrations/`, run `npx supabase db push --linked`. M2 adds a CI step that runs this automatically. Until then, manual push.
