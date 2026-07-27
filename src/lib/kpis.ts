import { supabaseAdmin } from './supabase';
import { getActiveClients, type DateRange } from './queries';
import { getSpeedToLead } from './csrMetrics';

// Consolidated, per-person team KPIs (the KPIs page). Aggregated ACROSS all clients —
// a setter's targets span every clinic they work, so nothing here is client-scoped.
//
// Three CSR / appointment-setter KPIs, each with Junior/Flat/Senior tiers:
//   • Confirmed bookings  — bookings that paid a booking fee (monthly count)
//   • Phone booking ratio — phone ÷ (phone + sms), from the manual channel flag
//   • Speed to Lead       — % of phoned new leads reached ≤30 min (9am–5pm)
//
// CSRs are keyed by FIRST NAME so the booking log ("Maddie") reconciles with the call
// log ("Maddie Byford"). The AI bot ("AI Agent") is excluded — it isn't a person.

export type CsrKpiRow = {
  csr: string;               // display name (first name)
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
    if (isBot(name)) return null;
    const key = firstKey(name);
    if (!key) return null;
    let r = by.get(key);
    if (!r) {
      r = { csr: displayFirst(name), confirmed: 0, bookingsTotal: 0, phone: 0, sms: 0, phonePct: null, speedLeads: 0, speedWithin: 0, speedPct: null };
      by.set(key, r);
    }
    return r;
  };

  // 1) Bookings across all clients for the month → confirmed / phone / sms per CSR.
  const { data: bk } = await supabaseAdmin
    .from('bookings')
    .select('csr, deposit_gbp, booking_channel')
    .eq('period_month', month)
    .not('csr', 'is', null)
    .limit(5000);
  for (const b of (bk ?? []) as { csr: string; deposit_gbp: number | null; booking_channel: string | null }[]) {
    const r = ensure(b.csr);
    if (!r) continue;
    r.bookingsTotal++;
    if (b.deposit_gbp != null) r.confirmed++;
    if (b.booking_channel === 'phone') r.phone++;
    else if (b.booking_channel === 'sms') r.sms++;
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

export async function getKpiMonths(): Promise<string[]> {
  const { data } = await supabaseAdmin.from('bookings').select('period_month').order('period_month', { ascending: false });
  const seen = new Set<string>();
  for (const r of (data ?? []) as { period_month?: string }[]) if (r.period_month) seen.add(String(r.period_month));
  return [...seen];
}
