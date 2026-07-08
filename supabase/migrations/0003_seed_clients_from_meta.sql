-- Make the registry the source of truth by backfilling it from existing Meta data.
--
-- The canonical client key across the whole app is the GHL location id — stored as
-- meta_accounts.client_id and as ghl_*.location_id. In the registry that key is
-- clients.ghl_location_id, so we seed one registry row per existing client with:
--   ghl_location_id    <- meta_accounts.client_id   (the join key)
--   meta_ad_account_id <- meta_accounts.source_id   (act_...)
--   client_name        <- meta_accounts.client_name
--
-- Idempotent — safe to run once after 0001 + 0002.

-- One GHL location = one client. Also lets the backfill skip dupes.
do $$
begin
  alter table public.clients add constraint clients_ghl_location_id_key unique (ghl_location_id);
exception when duplicate_object then null;
end $$;

insert into public.clients (client_name, status, meta_ad_account_id, ghl_location_id)
select distinct on (client_id)
  client_name,
  'active',
  source_id,
  client_id
from public.meta_accounts
where client_id is not null
  and client_id <> 'UNCAHP_AGENCY'
order by client_id, _synced_at desc nulls last
on conflict (ghl_location_id) do nothing;
