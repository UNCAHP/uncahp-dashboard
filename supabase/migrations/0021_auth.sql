-- Dashboard sign-in and page permissions.
--
-- People sign in with Supabase Auth (email + password). Each person has a profile with a
-- role, and each role lists the dashboard pages it can open. Page keys are the dashboard's
-- views: overview, client, funnel, calls (CSR Dashboard), kpis, clients, admin.
--
-- Both tables are RLS-locked with no policies: only the dashboard's server (service role)
-- reads or writes them, same as clients / funnels.
--
-- Idempotent — run once in the Supabase SQL Editor after 0001–0020.

create table if not exists public.roles (
  key         text primary key,
  label       text not null,
  pages       text[] not null default '{}',
  created_at  timestamptz not null default now()
);
alter table public.roles enable row level security;

insert into public.roles (key, label, pages) values
  ('admin',       'Admin',       array['overview', 'client', 'funnel', 'calls', 'kpis', 'clients', 'admin']),
  ('csr',         'CSR',         array['calls']),
  ('media_buyer', 'Media Buyer', array['overview', 'client', 'funnel'])
on conflict (key) do nothing;

create table if not exists public.user_profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  name        text,
  role_key    text not null references public.roles (key),
  csr_key     text,                         -- the setter this user is (CSRs), lowercased first name
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.user_profiles enable row level security;

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();
