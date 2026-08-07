import { supabaseAdmin } from './supabase';
import { getActiveClients, type DateRange } from './queries';
import { getSpeedToLead } from './csrMetrics';
import { BOOKINGS_KPIS_ENABLED } from './csrConstants';

// Consolidated, per-person team KPIs (the KPIs page). Aggregated ACROSS all clients —
// a setter's targets span every clinic they work, so nothing here is client-scoped.
//
// Three CSR / appointment-setter KPIs, each with Junior/Flat/Senior tiers:
//   • Confirmed bookings  — the setter's monthly booking total (sheet)
//   • Phone booking ratio — CALL ÷ (CALL + SMS) bookings (sheet)
//   • Speed to Lead       — % of phoned new leads reached ≤30 min (call log)
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
  speedLeads: number;        // leads this CSR was first to phone
  speedWithin: number;       // ...reached within 30 min
  speedPct: number | null;   // speed to lead
};

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
  const range = monthRange(month);
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

  // 2) Speed to Lead per CSR, merged across every client for the same month.
  const clients = await getActiveClients();
  const speeds = await Promise.all(clients.map(c => getSpeedToLead(c.client_id, range)));
  for (const s of speeds) {
    for (const p of s.perCsr) {
      const r = ensure(p.csr);
      if (!r) continue;
      r.speedLeads += p.called; // leads this setter phoned
      r.speedWithin += p.within;
    }
  }

  for (const r of by.values()) {
    const marked = r.phone + r.sms;
    r.phonePct = marked ? +((100 * r.phone) / marked).toFixed(1) : null;
    r.speedPct = r.speedLeads ? +((100 * r.speedWithin) / r.speedLeads).toFixed(1) : null;
  }

  return [...by.values()].sort((a, b) => b.confirmed - a.confirmed || (b.speedLeads - a.speedLeads));
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
