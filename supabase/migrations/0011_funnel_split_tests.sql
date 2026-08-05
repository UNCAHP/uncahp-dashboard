-- Split-test tracking — first-party page/opt-in/deposit events per funnel variant.
--
-- Meta's landing_page_view is attributed to the AD, so it can't be split by page
-- variation. Instead each funnel page loads a tiny script (served from /api/track/script)
-- that assigns a sticky variant, then beacons view/opt-in/deposit events to /api/track,
-- which writes them here. The dashboard reads this table to compare variants end-to-end.
--
-- Owned by the dashboard (not the ghl_* / meta_* pipelines). Idempotent — run once in the
-- Supabase SQL Editor after 0001–0010.

create table if not exists public.funnel_events (
  id           uuid primary key default gen_random_uuid(),
  funnel_key   text not null,                 -- the snippet's data-funnel slug (→ funnels.track_key)
  variant      text not null,                 -- which variation the visitor saw (e.g. 'a', 'b')
  visitor_id   text not null,                 -- anonymous sticky id from the visitor's cookie
  event        text not null
                 check (event in ('view', 'optin', 'deposit')),
  page_url     text,
  referrer     text,
  utm          jsonb not null default '{}',   -- {source, medium, campaign, content, term}
  user_agent   text,
  is_bot       boolean not null default false, -- flagged by UA on ingest; excluded from stats
  created_at   timestamptz not null default now()
);

-- Aggregation reads slice by funnel+variant+event; the visitor_id index powers the
-- distinct-visitor ("unique views") and first-touch attribution queries.
create index if not exists funnel_events_slice_idx on public.funnel_events (funnel_key, variant, event, created_at);
create index if not exists funnel_events_visitor_idx on public.funnel_events (funnel_key, visitor_id);

-- Lock it down: RLS on, no policies → only the service-role key can read/write. The
-- collector route and the dashboard both go through supabaseAdmin. Matches csr_calls.
alter table public.funnel_events enable row level security;

-- Extend the funnel registry with the split-test config the snippet + dashboard share.
--   track_key — the slug pasted into the funnel's <script data-funnel="…">. Unique so a
--               beacon maps to exactly one funnel.
--   variants  — [{ "key": "a", "label": "Green button" }, …]; labels the scoreboard,
--               the snippet just needs the keys (defaults to what it's given).
--   split_status — 'off' (no active test) | 'running' | 'decided'; drives the dashboard.
alter table public.funnels add column if not exists track_key text;
alter table public.funnels add column if not exists variants jsonb not null default '[]';
alter table public.funnels add column if not exists split_status text not null default 'off'
  check (split_status in ('off', 'running', 'decided'));

create unique index if not exists funnels_track_key_key on public.funnels (track_key)
  where track_key is not null;

-- Pre-aggregated summary the dashboard reads (distinct visitors per funnel/variant/event),
-- so reporting never pulls raw event rows. Bots excluded. Accessed via supabaseAdmin
-- (service_role), which bypasses RLS on the underlying table.
create or replace view public.funnel_split_summary as
  select funnel_key, variant, event, count(distinct visitor_id)::int as visitors
  from public.funnel_events
  where is_bot = false
  group by funnel_key, variant, event;
