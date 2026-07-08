-- Client management registry.
-- Source of truth for who our clients are, their active/archived status, and the
-- API credentials tied to each. Populated + edited from the dashboard Clients page.
--
-- SECURITY: this table holds secrets (ghl_api_key). RLS is enabled with NO policies,
-- so the anon/public key CANNOT read it. Only the service_role key (used server-side
-- by the dashboard) bypasses RLS and can access it. Never expose ghl_api_key to the
-- browser — the app returns only a masked hint.
--
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).

create extension if not exists pgcrypto;

create table if not exists public.clients (
  id                 uuid primary key default gen_random_uuid(),
  client_name        text not null,
  status             text not null default 'active'
                       check (status in ('active', 'archived')),

  -- Meta: the Ad Account ID is an identifier (not a credential). The access token
  -- lives at the agency level, not per-client.
  meta_ad_account_id text,

  -- GHL: the sub-account (location) id links to ghl_* data; the API key is a secret.
  ghl_location_id    text,
  ghl_api_key        text,

  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  archived_at        timestamptz
);

-- Keep updated_at fresh on every write.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- Lock it down: RLS on, no policies → only service_role can touch it.
alter table public.clients enable row level security;

create index if not exists clients_status_idx on public.clients (status);
