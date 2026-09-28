-- Client segment: B2C clinics vs B2B (UNCAHP's own agency funnels).
--
-- Funnel Analytics' portfolio totals (LP views, opt-ins, avg opt-in rate, deposits) are a
-- B2C benchmark. UNCAHP's own funnel sells to clinics, so its numbers would skew them.
-- B2B clients are still listed and reported per funnel — they're just left out of totals.
--
-- Idempotent — run once in the Supabase SQL Editor.

alter table public.clients add column if not exists segment text not null default 'b2c'
  check (segment in ('b2c', 'b2b'));

update public.clients set segment = 'b2b' where client_name = 'UNCAHP';
