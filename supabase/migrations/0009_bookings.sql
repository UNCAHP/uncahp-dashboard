-- Native clinic bookings (Phase 2 — pilot: Salon House).
--
-- The agency logs every booking in per-client Google Sheets "Profit Trackers". This
-- table brings that logging INTO the dashboard: rows are created either by extracting a
-- screenshot of the sheet (vision model → preview → confirm) or by manual entry.
--
-- Owned by the dashboard, NOT the ghl_*/profit_tracker_entries external pipeline — so we
-- can validate on write (treatment revenue is human-entered and unverifiable, so it must
-- be captured with guardrails, not trusted). The £30 deposit is the only figure that also
-- flows through Stripe (ghl_transactions) and can be reconciled later.
--
-- Idempotent — run once in the Supabase SQL Editor after 0001–0008.

create table if not exists public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  client_id           text not null,                 -- ghl_location_id (Salon House: Z59GAFN5HMSPgKclnUxs)

  -- identity / journey
  patient_name        text,
  patient_name_norm   text,                          -- trim+lower — dedupe + future ghl_contacts match
  is_new              boolean not null default false,-- sheet col N
  is_returning        boolean not null default false,-- sheet col R
  treatment_no        integer,                       -- sheet col T (nth treatment in the patient's journey)
  treatment           text,                          -- may be truncated in a screenshot
  treatment_truncated boolean not null default false,-- extractor flagged the name as cut off

  -- source / attribution
  source_note         text,                          -- Offer/Notes: "Landing Page" | "RT" | "Booked Direct" ...
  csr                 text,                          -- who booked
  practitioner        text,
  contact_source_id   text,                          -- nullable → future join to ghl_contacts.source_id

  -- dates
  app_date            date,                          -- ISO-normalised appointment date
  app_date_raw        text,                          -- exactly as seen ("1-Jul", "27-July")
  period_month        date not null,                 -- first of month (2026-07-01), from the sheet's month header

  -- money (GBP)
  deposit_gbp         numeric(10,2),                 -- £30, flows through Stripe → verifiable
  total_revenue_gbp   numeric(10,2),                 -- human-entered in-clinic; validated on write

  -- status (from the coloured "CC" pill — best-effort)
  cc_status           text not null default 'unknown'
                        check (cc_status in ('paid', 'pending', 'no_show', 'cancelled', 'unknown')),
  cc_confidence       text not null default 'low'
                        check (cc_confidence in ('high', 'low')),

  -- provenance
  entry_source        text not null default 'manual'
                        check (entry_source in ('screenshot', 'manual')),
  import_batch_id     uuid,                           -- groups all rows from one screenshot commit
  _synced_at          timestamptz,

  -- natural-key dedupe (computed in app as a sha256 hex): re-committing the same
  -- screenshot upserts (correcting fields) rather than duplicating rows.
  dedupe_key          text not null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists bookings_dedupe_key on public.bookings (dedupe_key);
create index if not exists bookings_client_month_idx on public.bookings (client_id, period_month);
create index if not exists bookings_client_date_idx  on public.bookings (client_id, app_date);
create index if not exists bookings_batch_idx        on public.bookings (import_batch_id);
create index if not exists bookings_name_norm_idx    on public.bookings (client_id, patient_name_norm);

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- Lock it down: RLS on, no policies → only the service-role key (dashboard server code)
-- can read/write. Matches clients / funnels / csr_calls. Accessed only via supabaseAdmin.
alter table public.bookings enable row level security;

-- Monthly, manually-compounded service fee — stored at MONTH level, not per booking.
-- Feeds Profit/Loss = monthly revenue − monthly ad spend − monthly service fee.
create table if not exists public.booking_month_costs (
  id               uuid primary key default gen_random_uuid(),
  client_id        text not null,
  period_month     date not null,                    -- first of month
  service_fee_gbp  numeric(10,2) not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists booking_month_costs_key
  on public.booking_month_costs (client_id, period_month);

drop trigger if exists booking_month_costs_set_updated_at on public.booking_month_costs;
create trigger booking_month_costs_set_updated_at
  before update on public.booking_month_costs
  for each row execute function public.set_updated_at();

alter table public.booking_month_costs enable row level security;
