-- Setter breaks (lunch) — Speed to Lead doesn't measure leads that arrive while the
-- account's setter is on a break.
--
-- Setters tell Viktor their lunch in the Start of Day thread ("@Viktor my lunch is 1-2pm").
-- Viktor sends it with the shift via POST /api/shifts as
--   "breaks": [{ "start": "13:00", "end": "14:00" }]
-- London local times. A post without "breaks" leaves the stored ones as they are.
--
-- Idempotent — run once in the Supabase SQL Editor after 0001–0022.

alter table public.csr_shifts
  add column if not exists breaks jsonb not null default '[]'::jsonb;
