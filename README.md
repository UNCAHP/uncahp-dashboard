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

### CSR booking KPIs (Google Sheet)

The **Confirmed bookings** and **Phone booking ratio** columns on the KPIs page come from
the *Appointment Setting Tracker* sheet, synced daily into `csr_sheet_bookings` by
`/api/cron/sync-sheets`. Two more env vars:

```bash
APPT_TRACKER_SCRIPT_URL=https://script.google.com/macros/s/AKfyc.../exec
APPT_TRACKER_SCRIPT_TOKEN=...        # shared secret, must match TOKEN in the Apps Script
```

The sheet is read via an **Apps Script web app**, not the Sheets API: service-account key
creation is blocked by the `iam.disableServiceAccountKeyCreation` org policy on `uncahp.com`,
so the dashboard has no way to authenticate to Google directly. The script runs as a user
who can view the sheet, needs no Cloud project, and returns only each setter tab's header
block + totals row as JSON. Parsing lives in `src/lib/sheetBookingsSync.ts`, not in the
script, so it stays in the repo and under review.

Setup instructions are in the header of
[`google-apps-script/appointment-tracker.gs`](google-apps-script/appointment-tracker.gs).
Generate the token with:

```bash
openssl rand -hex 32
```

The sync reads tabs named `<Setter> - <Month Year>` ("Cathy - August 2026") and stores the
month totals row from each. Tabs in the pre-July-2025 layout have no SMS/CALL split and are
skipped — they're listed in the sync response's `skipped` array. Setting
`BOOKINGS_KPIS_ENABLED = false` in `src/lib/csrConstants.ts` parks both columns as
"not tracked".

**After editing the Apps Script**, re-deploy it (Deploy → Manage deployments → edit →
Version: *New version*). Editing the code alone does not change what the `/exec` URL serves.

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
Set the env vars above in Vercel → Project → Settings → Environment Variables.
