-- CSR Dashboard: per-account bookings against a monthly target.
--
-- 1. clients.monthly_booking_target — set per client in the Clients page. The weekly
--    target is derived from it (pro rata by day), so there's no second field.
-- 2. csr_sheet_client_daily — the Appointment Setting Tracker's per-account cells, one row
--    per setter tab × day × account column. csr_sheet_daily (0014) only kept each day's
--    totals; the CSR Dashboard needs bookings per account to compare against its target.
--    From October 2026 the sheet logs each account as MAN (setter-made) / LP (booked on
--    the landing page). Older tabs logged SMS / CALL instead, so manual/lp are null there
--    and only total is known.
-- 3. csr_sheet_bookings.manual_bookings / lp_bookings — the same MAN / LP split at month
--    level, beside the old phone/SMS columns.
--
-- Idempotent — run once in the Supabase SQL Editor after 0001–0019.

alter table public.clients add column if not exists monthly_booking_target integer
  check (monthly_booking_target is null or monthly_booking_target >= 0);

alter table public.csr_sheet_bookings add column if not exists manual_bookings integer;
alter table public.csr_sheet_bookings add column if not exists lp_bookings integer;

create table if not exists public.csr_sheet_client_daily (
  id              uuid primary key default gen_random_uuid(),
  setter_key      text not null,          -- whose tab the cell is on (lowercased first name)
  period_month    date not null,          -- first of month, from the tab name
  booking_date    date not null,
  account         text not null,          -- the account column's header, as written in the sheet
  manual_bookings integer,                -- MAN; null on SMS / CALL tabs
  lp_bookings     integer,                -- LP;  null on SMS / CALL tabs
  total_bookings  integer not null default 0,
  source_tab      text not null,
  _synced_at      timestamptz not null default now()
);

-- The sync replaces a tab's rows wholesale (delete by setter + month, then insert), so a
-- cell a setter clears in the sheet disappears here too. This index serves that delete and
-- the month-scoped reads.
create index if not exists csr_sheet_client_daily_month_idx
  on public.csr_sheet_client_daily (period_month, setter_key);

alter table public.csr_sheet_client_daily enable row level security;

-- 4. client_csr_assignments — who owned each account, and from when. clients.csr_key keeps
--    the CURRENT owner (the Clients form edits it); this history lets Speed to Lead and the
--    bookings view credit each day to whoever owned the account that day, so a reassignment
--    doesn't rewrite past months. Changing the setter in the Clients form adds a row
--    effective from the 1st of that month.
create table if not exists public.client_csr_assignments (
  id               uuid primary key default gen_random_uuid(),
  ghl_location_id  text not null,
  csr_key          text,                  -- lowercased first name; null = self booking
  effective_from   date not null,
  created_at       timestamptz not null default now()
);
create unique index if not exists client_csr_assignments_key
  on public.client_csr_assignments (ghl_location_id, effective_from);
alter table public.client_csr_assignments enable row level security;

-- Baseline: the assignments in force until now (seeded by 0019), effective from the start.
-- Runs before the October changes below, so it captures the old owners.
insert into public.client_csr_assignments (ghl_location_id, csr_key, effective_from)
select ghl_location_id, csr_key, date '2000-01-01'
from public.clients
where ghl_location_id is not null
on conflict (ghl_location_id, effective_from) do nothing;

-- October 2026 reassignment, from the Notion "Active Clients" board (CSR column) as of
-- 14 Oct 2026. Registry names differ slightly from Notion in places (Dr. Libby, HiTech).
with changes(client_name, csr_key) as (values
  ('Dr. Libby Clinic',         'maddie'),
  ('Emzi Skin Clinic',         'maddie'),
  ('Sciene London',            'maddie'),
  ('TAG Aesthetics (Nadia)',   'maddie'),
  ('Evavas Medical Cosmetics', 'alexis'),
  ('Laser Light Clinic',       'alexis'),
  ('Moss Aesthetics',          'alexis'),
  ('TAG Aesthetics (April)',   'alexis'),
  ('HiTech Aesthetics',        'cathy')
)
insert into public.client_csr_assignments (ghl_location_id, csr_key, effective_from)
select c.ghl_location_id, ch.csr_key, date '2026-10-01'
from changes ch join public.clients c on c.client_name = ch.client_name
where c.ghl_location_id is not null
on conflict (ghl_location_id, effective_from) do update set csr_key = excluded.csr_key;

update public.clients c set csr_key = a.csr_key
from public.client_csr_assignments a
where a.ghl_location_id = c.ghl_location_id and a.effective_from = date '2026-10-01';
