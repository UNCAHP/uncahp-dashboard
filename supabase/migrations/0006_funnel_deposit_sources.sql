-- Attribute deposits by transaction SOURCE instead of a generic contact tag.
--
-- Clients reuse a generic "deposit paid" tag across every offer, so a tag can't tell
-- one funnel's deposits from another's. The GHL transaction's source name (e.g.
-- "LP - £50 Skin Analysis") DOES identify the offer, so each funnel now stores which
-- transaction source(s) count as its deposits.
--
-- Deposits = succeeded ghl_transactions in range whose entity_source_name is in this
-- list (dated by the charge, attributed by the source).
--
-- Idempotent — run once in the Supabase SQL Editor after 0001–0005.

alter table public.funnels add column if not exists deposit_sources text[] not null default '{}';
