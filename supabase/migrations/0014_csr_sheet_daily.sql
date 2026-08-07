-- Per-setter, per-DAY booking counts from the Appointment Setting Tracker sheet.
--
-- Same source as csr_sheet_bookings (0013), one level finer: that table stores the sheet's
-- "Days" totals row, this one stores each day row above it. Feeds the expandable daily
-- breakdown under each setter on the KPIs page.
--
-- Kept as a separate table rather than columns on csr_sheet_bookings because the grain is
-- different (one row per setter per day vs per setter per month), and the KPI scorecard
-- shouldn't have to read ~31x the rows just to render a monthly figure.
--
-- Idempotent — run once in the Supabase SQL Editor after 0001–0013.

create table if not exists public.csr_sheet_daily (
  id              uuid primary key default gen_random_uuid(),

  setter_key      text not null,          -- lowercased first name — matches csr_sheet_bookings
  setter          text not null,
  period_month    date not null,          -- first of month, for cheap month-scoped reads
  booking_date    date not null,          -- the day itself

  phone_bookings  integer not null default 0,  -- the day row's "CALL Total"
  sms_bookings    integer not null default 0,  -- the day row's "SMS Total"
  total_bookings  integer not null default 0,  -- the day row's "Total"

  source_tab      text not null,
  _synced_at      timestamptz not null default now(),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One row per setter per day.
create unique index if not exists csr_sheet_daily_key
  on public.csr_sheet_daily (setter_key, booking_date);
-- The page reads a whole month at a time.
create index if not exists csr_sheet_daily_month_idx
  on public.csr_sheet_daily (period_month);

drop trigger if exists csr_sheet_daily_set_updated_at on public.csr_sheet_daily;
create trigger csr_sheet_daily_set_updated_at
  before update on public.csr_sheet_daily
  for each row execute function public.set_updated_at();

alter table public.csr_sheet_daily enable row level security;
