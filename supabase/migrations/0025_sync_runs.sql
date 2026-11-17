-- Sync runs: lets the dashboard show "Syncing 12/23 clients…" while the daily sync is
-- running, and refresh itself once it's done.
--
-- The 06:00 UTC cron writes one sync_runs row, then each client's sync writes its own
-- sync_run_clients row when it starts and fills in finished_at when it ends. A run is
-- "in progress" while some of its clients haven't finished (capped at 20 minutes, so a
-- client sync that crashed can't leave the banner up forever).
--
-- Idempotent — run once in the Supabase SQL Editor after 0001–0024.

create table if not exists public.sync_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  clients_total integer not null default 0
);
create index if not exists sync_runs_started_idx on public.sync_runs (started_at desc);

create table if not exists public.sync_run_clients (
  run_id      uuid not null references public.sync_runs (id) on delete cascade,
  client_id   text not null,               -- GHL location id
  client_name text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  error       text,
  primary key (run_id, client_id)
);

-- Service role only, like the other internal tables.
alter table public.sync_runs enable row level security;
alter table public.sync_run_clients enable row level security;
