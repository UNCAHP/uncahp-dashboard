-- Replace the tracker sheet's per-account cells in one transaction.
--
-- The dashboard re-syncs the Appointment Setting Tracker whenever the CSR Dashboard is
-- opened and the last sync is more than 15 minutes old, so two syncs can overlap. Doing
-- "delete the synced tabs' rows, insert the new ones" as separate requests could then
-- leave a tab's cells in twice. This function does both inside one transaction, holding
-- an advisory lock so overlapping syncs run one after the other.
--
-- p_tabs: [{ "setter_key": "cathy", "period_month": "2026-10-01" }, …] — tabs being replaced
-- p_rows: the new csr_sheet_client_daily rows for those tabs
--
-- Idempotent — run once in the Supabase SQL Editor after 0001–0021.

create or replace function public.replace_csr_sheet_cells(p_tabs jsonb, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  perform pg_advisory_xact_lock(hashtext('replace_csr_sheet_cells'));

  delete from public.csr_sheet_client_daily d
  using jsonb_to_recordset(p_tabs) as t(setter_key text, period_month date)
  where d.setter_key = t.setter_key and d.period_month = t.period_month;

  insert into public.csr_sheet_client_daily
    (setter_key, period_month, booking_date, account, manual_bookings, lp_bookings, total_bookings, source_tab, _synced_at)
  select setter_key, period_month, booking_date, account, manual_bookings, lp_bookings, total_bookings, source_tab, _synced_at
  from jsonb_to_recordset(p_rows) as r(
    setter_key text, period_month date, booking_date date, account text,
    manual_bookings integer, lp_bookings integer, total_bookings integer, source_tab text, _synced_at timestamptz
  );
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Only the dashboard's server (service role) may call it.
revoke all on function public.replace_csr_sheet_cells(jsonb, jsonb) from public, anon, authenticated;
