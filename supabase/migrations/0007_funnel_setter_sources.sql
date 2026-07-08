-- Phone / appointment-setter deposits, tracked via a shared payment link.
--
-- Setters take deposits over the phone using ONE payment link that's reused across
-- every offer, so its transaction source is generic — unlike a funnel's own deposit
-- page (deposit_sources), it can't identify the offer on its own.
--
-- To attribute these safely, a setter-source deposit only counts for a funnel when the
-- paying contact carries ALL of that funnel's opt-in tags (landing page + quiz funnel +
-- campaign tag). That tag gate proves the lead came from this funnel and cleanly
-- excludes other-origin leads (e.g. Meta lead forms, which never get those tags).
--
-- Deposits = deposit_sources (counted unconditionally, offer-specific) UNION
--            setter_sources (counted only when the contact has all opt-in tags),
-- deduplicated per contact.
--
-- Idempotent — run once in the Supabase SQL Editor after 0001–0006.

alter table public.funnels add column if not exists setter_sources text[] not null default '{}';
