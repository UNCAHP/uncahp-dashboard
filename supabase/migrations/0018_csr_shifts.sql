-- Setter shifts — one row per setter per day, written by Viktor (the Slack CSR bot) after
-- the morning Start of Day check-in, via POST /api/shifts on the dashboard.
--
-- Speed to Lead used to assume a fixed 10am–6pm window. Setters actually work varying
-- hours (8–6, 8:30–6, days off), so the KPI now counts a new lead only if it arrived
-- while at least one setter was on shift that day. Days with no shift rows fall back to
-- the old window so history still renders.
--
-- Idempotent — run once in the Supabase SQL Editor.

create table if not exists public.csr_shifts (
  id           uuid primary key default gen_random_uuid(),
  shift_date   date not null,
  csr_key      text not null,            -- lowercased first name, matches csr_sheet_* tables
  csr_name     text not null,            -- as Viktor sent it
  shift_start  time,                     -- London local time; null when off
  shift_end    time,
  off          boolean not null default false,
  source       text not null default 'viktor',
  raw          jsonb,                    -- the payload as received, for debugging parses
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists csr_shifts_key on public.csr_shifts (csr_key, shift_date);
create index if not exists csr_shifts_date_idx on public.csr_shifts (shift_date);

drop trigger if exists csr_shifts_set_updated_at on public.csr_shifts;
create trigger csr_shifts_set_updated_at
  before update on public.csr_shifts
  for each row execute function public.set_updated_at();

-- RLS on, no policies → service-role only. The endpoint writes via supabaseAdmin.
alter table public.csr_shifts enable row level security;
