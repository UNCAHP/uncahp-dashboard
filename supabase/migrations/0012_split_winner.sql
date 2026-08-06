-- Records which version won a split test once it's called. When set (with split_status
-- 'decided'), the dashboard collapses the A/B comparison back to a simple funnel flow for
-- the winning version. Idempotent — run once in the Supabase SQL Editor after 0011.

alter table public.funnels add column if not exists winner_variant text;
