-- Adds clinic logo support to clients.
--   1. A `logo_url` column on public.clients (stores the public URL of the uploaded logo).
--   2. A public Storage bucket `client-logos` to hold the image files.
--
-- Logos are not secret, so the bucket is public (readable by <img> tags without auth).
-- Uploads are done server-side with the service_role key, which bypasses Storage RLS,
-- so no extra object policies are needed.
--
-- Idempotent — safe to run once in the Supabase SQL Editor after 0001_clients.sql.

alter table public.clients add column if not exists logo_url text;

insert into storage.buckets (id, name, public)
values ('client-logos', 'client-logos', true)
on conflict (id) do nothing;
