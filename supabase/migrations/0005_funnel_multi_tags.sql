-- Allow multiple opt-in / deposit tags per funnel (a contact counts as an opt-in /
-- deposit if it has ANY of the tags). Replaces the single-tag text columns with
-- text[] arrays, migrating any existing single value.
--
-- Idempotent — safe to run once after 0004_funnels.sql.

alter table public.funnels add column if not exists optin_tags   text[] not null default '{}';
alter table public.funnels add column if not exists deposit_tags text[] not null default '{}';

-- Carry over any values already set as single tags.
update public.funnels set optin_tags   = array[optin_tag]   where optin_tag   is not null and cardinality(optin_tags)   = 0;
update public.funnels set deposit_tags = array[deposit_tag] where deposit_tag is not null and cardinality(deposit_tags) = 0;

alter table public.funnels drop column if exists optin_tag;
alter table public.funnels drop column if exists deposit_tag;
