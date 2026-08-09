-- When a split test was called, so a decided test can take its place on the Optimisation
-- Cadence timeline.
--
-- Calling a test IS an optimisation: you changed the funnel to the winning version, on a
-- day, with better evidence than any before/after comparison can produce (both versions ran
-- simultaneously against randomly split traffic, so budget changes, seasonality and
-- day-of-week cancel out). Until now only the fact of a decision was stored — status and
-- winner — with no date, so it couldn't be placed in a month.
--
-- Nullable, and left null for tests called before this migration: an invented date would be
-- worse than an absent one, and those tests simply won't appear on the timeline.
--
-- Idempotent — run once in the Supabase SQL Editor after 0001–0015.

alter table public.funnels add column if not exists split_decided_at timestamptz;

-- Reading a month's decided tests is a range scan over this column.
create index if not exists funnels_split_decided_at_idx
  on public.funnels (split_decided_at desc)
  where split_decided_at is not null;
