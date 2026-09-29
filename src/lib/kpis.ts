import { supabaseAdmin } from './supabase';
import { getActiveClients, type DateRange } from './queries';
import { getSpeedToLead } from './csrMetrics';
import { setterClients, BOOKINGS_KPIS_ENABLED } from './csrConstants';

// Consolidated, per-person team KPIs (the KPIs page). Aggregated ACROSS all clients —
// a setter's targets span every clinic they work, so nothing here is client-scoped.
//
// Three CSR / appointment-setter KPIs, each with Junior/Flat/Senior tiers:
//   • Confirmed bookings  — the setter's monthly booking total (sheet)
//   • Phone booking ratio — CALL ÷ (CALL + SMS) bookings (sheet)
//   • Speed to Lead       — of every new lead on the setter's OWN clients that arrived
//                           during their shift, % reached by phone ≤30 min (call log)
//
// The first two come from the Appointment Setting Tracker Google Sheet, synced daily into
// csr_sheet_bookings; the third is computed from csr_calls. CSRs are keyed by FIRST NAME so
// the sheet's tab ("Cathy - August 2026") reconciles with the call log ("Cathy Bright").
// The AI bot ("AI Agent") is excluded — it isn't a person.

export type CsrKpiRow = {
  csr: string;               // display name (first name)
  hasSheetRow: boolean;      // had a tab in the tracker sheet for this month
  confirmed: number;
  bookingsTotal: number;
  phone: number;
  sms: number;
  phonePct: number | null;   // phone booking ratio
  speedLeads: number;        // new leads on this CSR's clients that arrived during their shift
  speedWithin: number;       // ...reached by phone within 30 min (by anyone — cover counts)
  speedPct: number | null;   // speed to lead
};

// ─── Speed to Lead, by setter ────────────────────────────────────────────────
// A setter is accountable for every new lead on the clients assigned to them
// (clients.csr_key) that arrived while they were on shift — including leads nobody
// phoned. When they're off, cover from whoever else was on shift counts (see
// csrMetrics.getShiftCoverage). Per-client rows show which accounts drag the rate.

export type CsrSpeedClientRow = {
  client_id: string;
  client_name: string;
  leads: number;
  within: number;
  neverCalled: number;
  pct: number | null;
};

export type CsrSpeedRow = {
  csr: string;               // display name (first name)
  key: string;               // lowercased first name
  leads: number;
  within: number;
  neverCalled: number;
  pct: number | null;
  clients: CsrSpeedClientRow[];
};

export async function getCsrSpeedToLead(month: string | null): Promise<CsrSpeedRow[]> {
  if (!month) return [];
  const range = monthRange(month);
  const clients = setterClients(await getActiveClients()).filter(c => !!c.csr_key);
  const speeds = await Promise.all(clients.map(c => getSpeedToLead(c.client_id, range)));

  const by = new Map<string, CsrSpeedRow>();
  clients.forEach((c, i) => {
    const key = c.csr_key as string;
    const s = speeds[i];
    const row = by.get(key) ?? { csr: key.charAt(0).toUpperCase() + key.slice(1), key, leads: 0, within: 0, neverCalled: 0, pct: null, clients: [] };
    row.leads += s.leadsInHours;
    row.within += s.contactedWithin;
    row.neverCalled += s.neverCalled;
    row.clients.push({
      client_id: c.client_id, client_name: c.client_name,
      leads: s.leadsInHours, within: s.contactedWithin, neverCalled: s.neverCalled,
      pct: s.leadsInHours ? +((100 * s.contactedWithin) / s.leadsInHours).toFixed(1) : null,
    });
    by.set(key, row);
  });
  for (const r of by.values()) {
    r.pct = r.leads ? +((100 * r.within) / r.leads).toFixed(1) : null;
    r.clients.sort((a, b) => b.leads - a.leads);
  }
  return [...by.values()].sort((a, b) => b.leads - a.leads);
}

const firstKey = (s: string | null | undefined): string =>
  String(s ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
const displayFirst = (s: string | null | undefined): string =>
  String(s ?? '').trim().split(/\s+/)[0] ?? '';
const isBot = (s: string | null | undefined): boolean => /agent|\bai\b|bot/i.test(String(s ?? ''));
// Calls whose GHL user has no name fall back to the raw user_id (see csrMetrics), which
// then shows up here as a scorecard row named e.g. "2RxPt6JJZ5ar0mzIbtL4". Those aren't
// people we score — drop them. Their leads still count in the team-level Call Tracking
// totals, which don't go through this per-person map.
const isRawUserId = (s: string | null | undefined): boolean => {
  const v = String(s ?? '').trim();
  return /^[A-Za-z0-9]{15,}$/.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v);
};

// Last day of a yyyy-mm-01 month, as yyyy-mm-dd.
export function monthRange(month: string): DateRange {
  const [y, m] = month.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { since: `${month.slice(0, 7)}-01`, until: `${month.slice(0, 7)}-${String(end).padStart(2, '0')}`, label: '' };
}

export async function getCsrScorecard(month: string | null): Promise<CsrKpiRow[]> {
  if (!month) return [];
  const by = new Map<string, CsrKpiRow>();
  const ensure = (name: string): CsrKpiRow | null => {
    if (isBot(name) || isRawUserId(name)) return null;
    const key = firstKey(name);
    if (!key) return null;
    let r = by.get(key);
    if (!r) {
      r = { csr: displayFirst(name), hasSheetRow: false, confirmed: 0, bookingsTotal: 0, phone: 0, sms: 0, phonePct: null, speedLeads: 0, speedWithin: 0, speedPct: null };
      by.set(key, r);
    }
    return r;
  };

  // 1) Bookings per setter for the month, from the Appointment Setting Tracker sheet
  // (synced daily into csr_sheet_bookings). One row per setter per month, already totalled
  // by the sheet — so this is an assignment, not an accumulation like the old per-booking
  // log was. Skipped entirely while BOOKINGS_KPIS_ENABLED is off.
  if (BOOKINGS_KPIS_ENABLED) {
    const { data: sb } = await supabaseAdmin
      .from('csr_sheet_bookings')
      .select('setter, phone_bookings, sms_bookings, total_bookings')
      .eq('period_month', month);
    for (const b of (sb ?? []) as { setter: string; phone_bookings: number; sms_bookings: number; total_bookings: number }[]) {
      const r = ensure(b.setter);
      if (!r) continue;
      r.hasSheetRow = true;
      r.confirmed = b.total_bookings;
      r.bookingsTotal = b.total_bookings;
      r.phone = b.phone_bookings;
      r.sms = b.sms_bookings;
    }
  }

  // 2) Speed to Lead per CSR — every new lead on their assigned clients that arrived on
  //    their shift, and how many were reached ≤30 min (same numbers as the by-setter card).
  for (const sp of await getCsrSpeedToLead(month)) {
    const r = ensure(sp.csr);
    if (!r) continue;
    r.speedLeads += sp.leads;
    r.speedWithin += sp.within;
  }

  for (const r of by.values()) {
    const marked = r.phone + r.sms;
    r.phonePct = marked ? +((100 * r.phone) / marked).toFixed(1) : null;
    r.speedPct = r.speedLeads ? +((100 * r.speedWithin) / r.speedLeads).toFixed(1) : null;
  }

  return [...by.values()].sort((a, b) => b.confirmed - a.confirmed || (b.speedLeads - a.speedLeads));
}

// One day's bookings for one setter, for the expandable breakdown under each scorecard row.
export type CsrDayRow = {
  date: string;    // yyyy-mm-dd
  phone: number;
  sms: number;
  total: number;
};

/**
 * Daily breakdown for every setter in a month, keyed by the same first-name key the
 * scorecard rows use. Read in one query and grouped here — a month is ~90 rows, so it's
 * cheaper than a request per setter.
 */
export async function getCsrDaily(month: string | null): Promise<Record<string, CsrDayRow[]>> {
  if (!month) return {};
  const { data } = await supabaseAdmin
    .from('csr_sheet_daily')
    .select('setter_key, booking_date, phone_bookings, sms_bookings, total_bookings')
    .eq('period_month', month)
    .order('booking_date');

  const by: Record<string, CsrDayRow[]> = {};
  for (const r of (data ?? []) as { setter_key: string; booking_date: string; phone_bookings: number; sms_bookings: number; total_bookings: number }[]) {
    (by[r.setter_key] ??= []).push({
      date: String(r.booking_date),
      phone: r.phone_bookings,
      sms: r.sms_bookings,
      total: r.total_bookings,
    });
  }
  return by;
}

/**
 * Hours since the tracker sheet last synced, or null if it never has.
 *
 * Read from the newest `_synced_at` across the whole table rather than the selected month —
 * the sync writes every month on each run, so a month-scoped read would report an old month
 * as stale simply because nobody has touched that tab since.
 */
export async function getSheetSyncAgeHours(): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from('csr_sheet_bookings')
    .select('_synced_at')
    .order('_synced_at', { ascending: false })
    .limit(1);
  const at = (data ?? [])[0]?._synced_at as string | undefined;
  if (!at) return null;
  return (Date.now() - Date.parse(at)) / 3_600_000;
}

// Months offered by the picker. Sourced from BOTH the synced sheet (every month with a
// setter tab) and the archived booking log, so historic months logged in the dashboard
// don't disappear from the picker now that Bookings is archived.
export async function getKpiMonths(): Promise<string[]> {
  const [sheet, logged] = await Promise.all([
    supabaseAdmin.from('csr_sheet_bookings').select('period_month'),
    supabaseAdmin.from('bookings').select('period_month'),
  ]);
  const seen = new Set<string>();
  for (const set of [sheet.data, logged.data]) {
    for (const r of (set ?? []) as { period_month?: string }[]) if (r.period_month) seen.add(String(r.period_month));
  }
  return [...seen].sort().reverse();
}
