# UNCAHP Dashboard

Performance dashboard for UNCAHP clients — Meta Ads × GHL × Profit Trackers.
Next.js (App Router) + Supabase, deployed on Vercel.

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
```

Create `.env.local` (never commit it):

```bash
SUPABASE_URL=...                 # the UNCAHP Supabase project URL
SUPABASE_SERVICE_ROLE_KEY=...    # see security note below — prefer a read-only key
BASIC_AUTH_USER=uncahp           # HTTP basic-auth gate (middleware)
BASIC_AUTH_PASSWORD=...
```

## Data

The dashboard only **reads** from Supabase — it never writes. Tables it queries:
`meta_daily_stats`, `meta_campaigns`, `meta_adsets`, `meta_ads`, `ghl_contacts`,
`ghl_funnels`, `ghl_funnel_pages`, `ghl_transactions`, `profit_tracker_entries`,
`meta_accounts`. These are populated by sync jobs that live outside this repo.

### Security note

This app currently uses the Supabase **service-role key**. Because it only reads,
it should use a **read-only key** instead (a DB role with `SELECT`-only grants, or
a restricted publishable key). Swap `SUPABASE_SERVICE_ROLE_KEY` for that and update
`src/lib/supabase.ts` accordingly — then even repo + deploy access can't write to
the database.

## Deploy

Connected to the Vercel project `uncahp-dashboard`. Push to `main` → auto-deploy.
Set the four env vars above in Vercel → Project → Settings → Environment Variables.
