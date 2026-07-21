-- Call events per client, for the CSR "Speed to Lead" KPI.
--
-- GHL logs every call as a conversation message (TYPE_CALL) carrying the CSR who made
-- it, the direction, the status and a timestamp — but that message data isn't part of
-- the external pipeline (ghl_messages is empty). Walking the API live is far too slow
-- for a page load (~45s per client per month), so we sync the call events we care about
-- into this table and read from it.
--
-- Owned by the dashboard (not the ghl_* pipeline), hence the csr_ prefix.
-- The CSR name is denormalised onto each row so the KPI needs no join.
--
-- Idempotent — run once in the Supabase SQL Editor after 0001–0007.

create table if not exists public.csr_calls (
  id                uuid primary key default gen_random_uuid(),
  location_id       text not null,
  source_id         text not null,               -- GHL message id (natural key)
  contact_source_id text,                        -- → ghl_contacts.source_id
  user_id           text,                        -- GHL user who made/took the call
  user_name         text,                        -- denormalised CSR name
  direction         text,                        -- inbound | outbound
  status            text,                        -- completed | no-answer | canceled | voicemail
  duration_sec      integer,
  call_at           timestamptz,
  _synced_at        timestamptz not null default now()
);

-- One row per GHL call message; lets the sync upsert safely.
create unique index if not exists csr_calls_source_id_key on public.csr_calls (source_id);
create index if not exists csr_calls_lookup_idx on public.csr_calls (location_id, contact_source_id, call_at);

-- Lock it down: RLS on, no policies → only the service-role key (used by the dashboard's
-- server code) can read/write; the public anon key gets nothing. The app reads/writes
-- csr_calls exclusively via supabaseAdmin, so this doesn't break anything. Matches how
-- clients / ghl_api_keys are secured.
alter table public.csr_calls enable row level security;
