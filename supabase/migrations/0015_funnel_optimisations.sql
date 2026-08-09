-- Optimisation cadence log — one row per change made to a funnel.
--
-- The monthly review question is "what did we change, and did it work?". Each row records
-- the change; the before/after numbers are NOT stored, they're computed on read from
-- meta_daily_stats / ghl_* for the 7 days either side of change_date. That way a snapshot
-- always reflects the latest synced data (Meta backfills conversions for days after the
-- fact), and re-running a month never disagrees with the funnel page above it.
--
-- verdict is the human's call. The dashboard suggests one from the primary metric's move,
-- but a 7-day window shifts for reasons that have nothing to do with the test — budget
-- changes, seasonality, a clinic closing for a week — so the judgement stays with the user
-- and null means "not decided yet".
--
-- Idempotent — run once in the Supabase SQL Editor after 0001–0014.

create table if not exists public.funnel_optimisations (
  id             uuid primary key default gen_random_uuid(),

  funnel_id      uuid not null references public.funnels(id) on delete cascade,
  change_date    date not null,               -- the day the change went live

  -- what was done
  title          text not null,               -- "Swapped hero headline to price-led"
  detail         text,                        -- optional longer description / hypothesis

  -- which number the change was meant to move; drives the suggested verdict
  primary_metric text not null default 'deposit_rate'
                   check (primary_metric in ('optin_rate', 'deposit_rate', 'optins', 'deposits', 'lp_views')),

  -- the human's call. null = not decided yet (usual while the after-window is still open).
  verdict        text
                   check (verdict is null or verdict in ('win', 'loss', 'flat', 'rolled_back')),
  verdict_note   text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The log reads a month at a time, newest first.
create index if not exists funnel_optimisations_date_idx
  on public.funnel_optimisations (change_date desc);
create index if not exists funnel_optimisations_funnel_idx
  on public.funnel_optimisations (funnel_id, change_date desc);

drop trigger if exists funnel_optimisations_set_updated_at on public.funnel_optimisations;
create trigger funnel_optimisations_set_updated_at
  before update on public.funnel_optimisations
  for each row execute function public.set_updated_at();

-- Lock it down: RLS on, no policies → only the service-role key (dashboard server code)
-- can read/write. Matches funnels / clients / csr_*.
alter table public.funnel_optimisations enable row level security;
