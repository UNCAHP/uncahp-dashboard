import { supabase, supabaseAdmin } from './supabase';
import type { DateRange } from './queries';
import { SPEED_TO_LEAD_MINUTES, hasRefTag } from './csrConstants';

// ─── Speed to Lead ───────────────────────────────────────────────────────────
// "% of new leads with an outbound dial within 30 min of enquiry, during setter shifts".
//
//   A NEW LEAD  — a GHL contact created in range that has a phone number AND a campaign
//                 REF tag (csrConstants.REF_TAG_RE). Untagged contacts and reactivation
//                 lists aren't new enquiries.
//   MEASURED    — only if it arrived while someone responsible was on shift (csr_shifts,
//                 written daily by Viktor after the Start of Day check-in; London time):
//                 the client's assigned setter (clients.csr_key), or — when they're off —
//                 whoever else was on shift (cover). A day with no shift rows, or a lead
//                 arriving when nobody's on, isn't measured at all.
//   SELF-BOOKED — a lead that paid a deposit within the 30-minute window, before anyone
//                 dialled, sorted itself out and is left out of the measure. A lead that
//                 paid later without a call is still a missed response; one that paid
//                 after a call stays in — that's the KPI working.
//   ATTEMPTED   — an outbound dial within 30 min, answered or not. This is the scored KPI:
//                 a setter can't make a lead pick up. A lead nobody phoned is a MISS.
//   CONNECTED   — a completed outbound call of ≥60s within 30 min (the same bar as a
//                 "conversation"). Shown alongside as the outcome; not scored.
//
// Credit for an attempt goes to whoever dialled first. Accountability for a lead (the
// per-shift view) goes to the RESPONSIBLE setter: the assigned one if on shift, otherwise
// the cover who dialled, otherwise the first cover on shift.

const CONVERSATION_MIN_SEC = 60;

// London-local helpers.
const londonDate = (iso: string): string => {
  const p = new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/');
  return `${p[2]}-${p[1]}-${p[0]}`;
};
const londonClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });

const firstName = (s: string): string => s.trim().split(/\s+/)[0]?.toLowerCase() ?? '';

// Supabase caps a select at 1000 rows; page through anything that can exceed it.
async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export type Shift = { date: string; csr: string; start: string; end: string; off: boolean };

export async function getShifts(range: DateRange): Promise<Shift[]> {
  const { data } = await supabaseAdmin
    .from('csr_shifts')
    .select('shift_date, csr_key, shift_start, shift_end, off')
    .gte('shift_date', range.since)
    .lte('shift_date', range.until)
    .order('shift_date')
    .order('shift_start');
  return (data ?? []).map(r => ({
    date: r.shift_date as string,
    csr: r.csr_key as string,
    start: r.off ? '' : String(r.shift_start ?? '').slice(0, 5),
    end: r.off ? '' : String(r.shift_end ?? '').slice(0, 5),
    off: !!r.off || !r.shift_start || !r.shift_end,
  }));
}

// One evaluated lead — everything the views need, computed once.
export type LeadEval = {
  client_id: string;
  source_id: string;
  name: string;
  arrivedAt: string;           // ISO
  day: string;                 // London yyyy-mm-dd
  responsible: string;         // csr key accountable for this lead (see header)
  cover: boolean;              // responsible ≠ the client's assigned setter
  firstDialAt: string | null;
  firstDialBy: string | null;  // display name of whoever dialled first
  minsToDial: number | null;
  attempted: boolean;          // dialled ≤30m
  connected: boolean;          // completed ≥60s call ≤30m
  paidAt: string | null;       // first succeeded deposit, if any
  selfBooked: boolean;         // paid ≤30m after enquiry, before any dial → not measured
};

type ClientAssign = { client_id: string; csr: string | null };

// Evaluate every measurable new lead for the given clients in range.
export async function evaluateLeads(clients: ClientAssign[], range: DateRange): Promise<LeadEval[]> {
  const ids = clients.map(c => c.client_id).filter(Boolean);
  if (ids.length === 0) return [];
  const assigned = new Map(clients.map(c => [c.client_id, c.csr]));

  const [contacts, calls, shifts, txns] = await Promise.all([
    pageAll<{ location_id: string; source_id: string; first_name: string | null; last_name: string | null; date_added: string | null; phone: string | null; tags: unknown }>((f, t) =>
      supabase.from('ghl_contacts')
        .select('location_id, source_id, first_name, last_name, date_added, phone, tags')
        .in('location_id', ids)
        .gte('date_added', `${range.since}T00:00:00Z`)
        .lte('date_added', `${range.until}T23:59:59Z`)
        .range(f, t)),
    // No upper bound: a lead near the end of the range may be dialled after it.
    pageAll<{ location_id: string; contact_source_id: string | null; user_name: string | null; user_id: string | null; call_at: string | null; status: string | null; duration_sec: number | null }>((f, t) =>
      supabaseAdmin.from('csr_calls')
        .select('location_id, contact_source_id, user_name, user_id, call_at, status, duration_sec')
        .in('location_id', ids)
        .eq('direction', 'outbound')
        .gte('call_at', `${range.since}T00:00:00Z`)
        .range(f, t)),
    getShifts(range),
    pageAll<{ contact_source_id: string | null; charge_created_at: string | null }>((f, t) =>
      supabase.from('ghl_transactions')
        .select('contact_source_id, charge_created_at')
        .in('location_id', ids)
        .eq('status', 'succeeded')
        .gte('charge_created_at', `${range.since}T00:00:00Z`)
        .range(f, t)),
  ]);

  // Earliest succeeded deposit per contact.
  const firstPaid = new Map<string, string>();
  for (const t of txns) {
    if (!t.contact_source_id || !t.charge_created_at) continue;
    const prev = firstPaid.get(t.contact_source_id);
    if (!prev || t.charge_created_at < prev) firstPaid.set(t.contact_source_id, t.charge_created_at);
  }

  // Earliest attempt + earliest connected call per contact.
  const firstCall = new Map<string, { at: string; by: string }>();
  const firstConnected = new Map<string, string>();
  for (const c of calls) {
    if (!c.contact_source_id || !c.call_at) continue;
    const prev = firstCall.get(c.contact_source_id);
    if (!prev || c.call_at < prev.at) firstCall.set(c.contact_source_id, { at: c.call_at, by: c.user_name || c.user_id || '(unknown)' });
    if (c.status === 'completed' && (c.duration_sec ?? 0) >= CONVERSATION_MIN_SEC) {
      const pc = firstConnected.get(c.contact_source_id);
      if (!pc || c.call_at < pc) firstConnected.set(c.contact_source_id, c.call_at);
    }
  }

  // Shifts by day, on-shift ones only, earliest start first.
  const byDay = new Map<string, Shift[]>();
  for (const s of shifts) {
    if (s.off) continue;
    const l = byDay.get(s.date) ?? [];
    l.push(s);
    byDay.set(s.date, l);
  }
  for (const l of byDay.values()) l.sort((a, b) => a.start.localeCompare(b.start) || a.csr.localeCompare(b.csr));

  const out: LeadEval[] = [];
  for (const l of contacts) {
    if (!l.date_added || !String(l.phone ?? '').trim() || !hasRefTag(l.tags)) continue;
    const day = londonDate(l.date_added);
    const t = londonClock(l.date_added);
    const on = (byDay.get(day) ?? []).filter(s => t >= s.start && t < s.end);
    if (on.length === 0) continue; // nobody on shift → not measured

    const fc = firstCall.get(l.source_id);
    const dial = fc && fc.at > l.date_added ? fc : null;
    const dialBy = dial ? firstName(dial.by) : null;

    const own = assigned.get(l.location_id) ?? null;
    let responsible: string;
    if (own && on.some(s => s.csr === own)) responsible = own;
    else if (dialBy && on.some(s => s.csr === dialBy)) responsible = dialBy;
    else responsible = on[0].csr;

    const mins = dial ? (Date.parse(dial.at) - Date.parse(l.date_added)) / 60000 : null;
    const conn = firstConnected.get(l.source_id);
    const paidAt = firstPaid.get(l.source_id) ?? null;
    const selfBooked = !!paidAt && paidAt > l.date_added
      && (Date.parse(paidAt) - Date.parse(l.date_added)) / 60000 <= SPEED_TO_LEAD_MINUTES
      && (!dial || paidAt < dial.at);
    out.push({
      client_id: l.location_id,
      source_id: l.source_id,
      name: `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim() || '(no name)',
      arrivedAt: l.date_added,
      day,
      responsible,
      cover: responsible !== own,
      firstDialAt: dial?.at ?? null,
      firstDialBy: dial?.by ?? null,
      minsToDial: mins == null ? null : Math.round(mins),
      attempted: mins != null && mins <= SPEED_TO_LEAD_MINUTES,
      connected: !!conn && conn > l.date_added && (Date.parse(conn) - Date.parse(l.date_added)) / 60000 <= SPEED_TO_LEAD_MINUTES,
      paidAt,
      selfBooked,
    });
  }
  return out.sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
}

// ─── Per-client summary (kept for the KPIs page + Call Tracking detail) ──────

export type CsrSpeedRow = {
  csr: string;         // display name of whoever dialled first
  called: number;      // leads this CSR was the first to phone
  within: number;      // ...within the 30-min target
  pct: number | null;
};

export type SpeedToLead = {
  leadsInHours: number;      // measured new leads (the denominator)
  phoned: number;            // ...that got any outbound call
  contactedWithin: number;   // ...dialled ≤30m (scored)
  connectedWithin: number;   // ...connected ≤30m (outcome)
  pct: number | null;
  neverCalled: number;
  selfBooked: number;        // paid a deposit ≤30m, before any call — left out of the measure
  medianMinutes: number | null;
  perCsr: CsrSpeedRow[];
  callsOnFile: number;       // rows in csr_calls for this client (0 ⇒ not synced yet)
};

export function summarise(all: LeadEval[]): Omit<SpeedToLead, 'callsOnFile'> {
  const selfBooked = all.filter(l => l.selfBooked).length;
  const leads = all.filter(l => !l.selfBooked);
  let phoned = 0, within = 0, connected = 0;
  const deltas: number[] = [];
  const perCsr = new Map<string, CsrSpeedRow>();
  for (const l of leads) {
    if (l.firstDialBy && l.minsToDial != null) {
      phoned++;
      deltas.push(l.minsToDial);
      const row = perCsr.get(l.firstDialBy) ?? { csr: l.firstDialBy, called: 0, within: 0, pct: null };
      row.called++;
      if (l.attempted) row.within++;
      perCsr.set(l.firstDialBy, row);
    }
    if (l.attempted) within++;
    if (l.connected) connected++;
  }
  for (const r of perCsr.values()) r.pct = r.called ? +((100 * r.within) / r.called).toFixed(1) : null;
  deltas.sort((a, b) => a - b);
  return {
    leadsInHours: leads.length,
    phoned,
    contactedWithin: within,
    connectedWithin: connected,
    pct: leads.length ? +((100 * within) / leads.length).toFixed(1) : null,
    neverCalled: leads.length - phoned,
    selfBooked,
    medianMinutes: deltas.length ? deltas[Math.floor(deltas.length / 2)] : null,
    perCsr: [...perCsr.values()].sort((a, b) => b.called - a.called),
  };
}

async function assignmentFor(clientId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('clients').select('csr_key').eq('ghl_location_id', clientId).maybeSingle();
  return (data as { csr_key?: string | null } | null)?.csr_key ?? null;
}

export async function getSpeedToLead(clientId: string, range: DateRange): Promise<SpeedToLead> {
  if (!clientId) return { leadsInHours: 0, phoned: 0, contactedWithin: 0, connectedWithin: 0, pct: null, neverCalled: 0, selfBooked: 0, medianMinutes: null, perCsr: [], callsOnFile: 0 };
  const [csr, { count }] = await Promise.all([
    assignmentFor(clientId),
    supabaseAdmin.from('csr_calls').select('*', { count: 'exact', head: true }).eq('location_id', clientId),
  ]);
  const leads = await evaluateLeads([{ client_id: clientId, csr }], range);
  return { ...summarise(leads), callsOnFile: count ?? 0 };
}

// Call Tracking detail: the summary plus the lead-by-lead log.
export type ClientSpeed = SpeedToLead & { leads: LeadEval[]; assigned: string | null };

export async function getClientSpeed(clientId: string, range: DateRange): Promise<ClientSpeed> {
  const [csr, { count }] = await Promise.all([
    assignmentFor(clientId),
    supabaseAdmin.from('csr_calls').select('*', { count: 'exact', head: true }).eq('location_id', clientId),
  ]);
  const leads = await evaluateLeads([{ client_id: clientId, csr }], range);
  return { ...summarise(leads), callsOnFile: count ?? 0, leads, assigned: csr };
}

// ─── Call Tracking overview: one row per client ──────────────────────────────

export type ClientSpeedRow = {
  client_id: string;
  csr: string | null;
  leads: number;
  attempted: number;
  connected: number;
  neverCalled: number;
  selfBooked: number;
  pct: number | null;
};

export async function getClientSpeedRows(clients: ClientAssign[], range: DateRange): Promise<ClientSpeedRow[]> {
  const leads = await evaluateLeads(clients, range);
  const by = new Map<string, ClientSpeedRow>();
  for (const c of clients) by.set(c.client_id, { client_id: c.client_id, csr: c.csr, leads: 0, attempted: 0, connected: 0, neverCalled: 0, selfBooked: 0, pct: null });
  for (const l of leads) {
    const r = by.get(l.client_id);
    if (!r) continue;
    if (l.selfBooked) { r.selfBooked++; continue; }
    r.leads++;
    if (l.attempted) r.attempted++;
    if (l.connected) r.connected++;
    if (!l.firstDialBy) r.neverCalled++;
  }
  for (const r of by.values()) r.pct = r.leads ? +((100 * r.attempted) / r.leads).toFixed(1) : null;
  return [...by.values()];
}

// ─── Shifts scorecard: one row per setter per day ────────────────────────────

export type ShiftRow = {
  date: string;
  csr: string;
  start: string;     // '' when off
  end: string;
  off: boolean;
  leads: number;     // leads this setter was responsible for that day
  attempted: number;
  connected: number;
  neverCalled: number;
  pct: number | null;
  coverLeads: number; // ...of which came from covering someone else's client
};

export type ShiftScorecard = {
  days: { date: string; rows: ShiftRow[] }[];   // newest first
  setters: { csr: string; shifts: number; leads: number; attempted: number; connected: number; neverCalled: number; pct: number | null }[];
};

export async function getShiftScorecard(clients: ClientAssign[], range: DateRange): Promise<ShiftScorecard> {
  const [shifts, leads] = await Promise.all([getShifts(range), evaluateLeads(clients, range)]);

  const rows = new Map<string, ShiftRow>(); // `${date}|${csr}`
  for (const s of shifts) {
    rows.set(`${s.date}|${s.csr}`, { date: s.date, csr: s.csr, start: s.start, end: s.end, off: s.off, leads: 0, attempted: 0, connected: 0, neverCalled: 0, pct: null, coverLeads: 0 });
  }
  for (const l of leads) {
    if (l.selfBooked) continue;
    const r = rows.get(`${l.day}|${l.responsible}`);
    if (!r) continue;
    r.leads++;
    if (l.attempted) r.attempted++;
    if (l.connected) r.connected++;
    if (!l.firstDialBy) r.neverCalled++;
    if (l.cover) r.coverLeads++;
  }
  for (const r of rows.values()) r.pct = r.leads ? +((100 * r.attempted) / r.leads).toFixed(1) : null;

  const byDate = new Map<string, ShiftRow[]>();
  for (const r of rows.values()) {
    const l = byDate.get(r.date) ?? [];
    l.push(r);
    byDate.set(r.date, l);
  }
  const days = [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => ({ date, rows: list.sort((a, b) => Number(a.off) - Number(b.off) || a.start.localeCompare(b.start) || a.csr.localeCompare(b.csr)) }));

  const setters = new Map<string, ShiftScorecard['setters'][number]>();
  for (const r of rows.values()) {
    const s = setters.get(r.csr) ?? { csr: r.csr, shifts: 0, leads: 0, attempted: 0, connected: 0, neverCalled: 0, pct: null };
    if (!r.off) s.shifts++;
    s.leads += r.leads; s.attempted += r.attempted; s.connected += r.connected; s.neverCalled += r.neverCalled;
    setters.set(r.csr, s);
  }
  for (const s of setters.values()) s.pct = s.leads ? +((100 * s.attempted) / s.leads).toFixed(1) : null;

  return { days, setters: [...setters.values()].sort((a, b) => b.leads - a.leads) };
}
