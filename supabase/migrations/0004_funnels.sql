-- Funnel registry — manually-defined funnels, mirroring the client registry.
-- Each funnel belongs to a client (by ghl_location_id) and configures how we track it:
--   pages             — ordered [{name, url}] links to each page in the funnel
--   optin_tag         — GHL contact tag that signals an opt-in
--   deposit_tag       — GHL contact tag that signals a deposit
--   meta_campaign_ids — Meta campaign source_ids that feed this funnel's LP views
--
-- Analytics (phase 2) computes: LP Views (Meta landing_page_view for the mapped
-- campaigns) → Opt-ins (optin_tag count) → Deposits (deposit_tag count).
--
-- SECURITY: RLS on, no policies → only the service_role key (server-side) can access.
-- Run once in the Supabase SQL Editor after 0001–0003.

create table if not exists public.funnels (
  id                uuid primary key default gen_random_uuid(),
  client_id         text not null,                 -- ghl_location_id (→ clients.ghl_location_id)
  name              text not null,
  status            text not null default 'active'
                      check (status in ('active', 'archived')),
  optin_tag         text,
  deposit_tag       text,
  meta_campaign_ids text[] not null default '{}',
  pages             jsonb  not null default '[]',   -- [{ "name": ..., "url": ... }]
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  archived_at       timestamptz
);

-- Reuse the updated_at trigger function created in 0001_clients.sql.
drop trigger if exists funnels_set_updated_at on public.funnels;
create trigger funnels_set_updated_at
  before update on public.funnels
  for each row execute function public.set_updated_at();

alter table public.funnels enable row level security;

create index if not exists funnels_client_idx on public.funnels (client_id);
create index if not exists funnels_status_idx on public.funnels (status);
