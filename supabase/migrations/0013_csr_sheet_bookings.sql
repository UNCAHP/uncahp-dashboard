-- Per-setter monthly booking counts, synced from the "Appointment Setting Tracker"
-- Google Sheet (the agency's source of truth for who booked what).
--
-- The sheet has one tab per setter per month, named "<Setter> - <Month Year>"
-- (e.g. "Cathy - August 2026"), each a client × day grid of SMS / CALL bookings with a
-- "Days" totals row at the bottom. We only store that totals row — the per-client and
-- per-day detail stays in the sheet.
--
-- Feeds two columns of the CSR scorecard on the KPIs page:
--   • Confirmed bookings  = total_bookings
--   • Phone booking ratio = phone_bookings ÷ (phone_bookings + sms_bookings)
--
-- Owned by the dashboard (synced daily by /api/cron/sync-sheets), so re-running the sync
-- overwrites a month in place rather than accumulating duplicates.
--
-- Idempotent — run once in the Supabase SQL Editor after 0001–0012.

create table if not exists public.csr_sheet_bookings (
  id              uuid primary key default gen_random_uuid(),

  setter_key      text not null,          -- lowercased first name — joins to the call log's CSR
  setter          text not null,          -- display name as written on the tab ("Cathy")
  period_month    date not null,          -- first of month (2026-08-01), from the tab name

  phone_bookings  integer not null default 0,  -- the sheet's "CALL Total"
  sms_bookings    integer not null default 0,  -- the sheet's "SMS Total"
  total_bookings  integer not null default 0,  -- the sheet's "Total" (kept as written, not recomputed)

  source_tab      text not null,          -- exact tab name, so a bad row is traceable to its sheet
  _synced_at      timestamptz not null default now(),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One row per setter per month — the sync upserts on this.
create unique index if not exists csr_sheet_bookings_key
  on public.csr_sheet_bookings (setter_key, period_month);
create index if not exists csr_sheet_bookings_month_idx
  on public.csr_sheet_bookings (period_month);

drop trigger if exists csr_sheet_bookings_set_updated_at on public.csr_sheet_bookings;
create trigger csr_sheet_bookings_set_updated_at
  before update on public.csr_sheet_bookings
  for each row execute function public.set_updated_at();

-- Lock it down: RLS on, no policies → only the service-role key (dashboard server code)
-- can read/write. Matches clients / funnels / csr_calls / bookings.
alter table public.csr_sheet_bookings enable row level security;
