-- Competitor price scans (Competitors page).
--
-- A scan looks up what clinics near one of our clients charge for one treatment: a
-- Firecrawl web search for "<treatment> price <town>", then each result page read for
-- its prices. Scans run on demand only (they cost Firecrawl credits) and are kept, so a
-- scan is paid for once and can be compared later.
--
-- Idempotent — run once in the Supabase SQL Editor after 0001–0023.

create table if not exists public.competitor_scans (
  id             uuid primary key default gen_random_uuid(),
  client_id      text not null,                -- GHL location id
  treatment      text not null,
  town           text,
  postcode       text,
  lat            double precision,
  lng            double precision,
  radius_miles   numeric not null default 10,
  our_price_gbp  numeric,                      -- our client's price, to compare against
  status         text not null default 'done', -- done | error
  error          text,
  pages_read     integer not null default 0,
  credits_used   integer,
  created_by     text,
  created_at     timestamptz not null default now()
);
create index if not exists competitor_scans_client_idx on public.competitor_scans (client_id, created_at desc);

create table if not exists public.competitor_prices (
  id              uuid primary key default gen_random_uuid(),
  scan_id         uuid not null references public.competitor_scans (id) on delete cascade,
  clinic_name     text not null,
  website         text,
  source_url      text,
  postcode        text,
  lat             double precision,
  lng             double precision,
  distance_miles  numeric,                     -- null when the clinic's postcode isn't known
  label           text,                        -- what the price is for, as the page puts it
  price_gbp       numeric,
  price_text      text,
  kind            text,                        -- single | from | course | per_area | other
  is_main         boolean not null default false, -- the clinic's standard full-session price
  notes           text
);
create index if not exists competitor_prices_scan_idx on public.competitor_prices (scan_id);

-- Service role only, like the other internal tables.
alter table public.competitor_scans enable row level security;
alter table public.competitor_prices enable row level security;
